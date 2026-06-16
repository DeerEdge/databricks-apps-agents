"""Read-only access to Databricks facilities + write enrichment results via SQL Statement API."""

from __future__ import annotations

import time
import logging
from dataclasses import dataclass
from typing import Any

import requests

from .config import Config

log = logging.getLogger(__name__)


@dataclass
class Facility:
    name: str
    city: str
    state: str
    postcode: str | None
    latitude: float | None
    longitude: float | None
    citation: str | None   # capability evidence text — useful for search context
    trust: str


class DatabricksClient:
    """Thin wrapper around the SQL Statement Execution API (parameterized queries only)."""

    _POLL_INTERVAL = 1.5
    _DEADLINE_S = 90

    def __init__(self, cfg: Config) -> None:
        self._host = cfg.databricks_host.rstrip("/")
        self._token = cfg.databricks_token
        self._warehouse = cfg.warehouse_id
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        })

    # ── public ────────────────────────────────────────────────────────────

    def load_facilities(
        self,
        capability: str = "icu",
        state: str | None = None,
        only_missing: bool = False,
        images_table: str = "workspace.meddesert.hospital_images",
    ) -> list[Facility]:
        """Return facilities from facility_capability, optionally filtered to those
        without an accepted image yet (--only-missing mode)."""
        where = (
            "capability = :cap AND trust <> 'none'"
            " AND TRY_CAST(latitude AS DOUBLE) BETWEEN 6 AND 38"
            " AND TRY_CAST(longitude AS DOUBLE) BETWEEN 68 AND 98"
        )
        params: list[dict] = [{"name": "cap", "value": capability, "type": "STRING"}]

        if state:
            where += " AND upper(trim(state)) = upper(trim(:state))"
            params.append({"name": "state", "value": state, "type": "STRING"})

        missing_clause = ""
        if only_missing:
            missing_clause = f"""
              AND name NOT IN (
                SELECT hospital_name FROM {images_table}
                WHERE overall_confidence >= 0.70
              )
            """

        sql = f"""
        SELECT DISTINCT
               name,
               any_value(city)        AS city,
               any_value(state)       AS state,
               any_value(postcode)    AS postcode,
               any_value(latitude)    AS latitude,
               any_value(longitude)   AS longitude,
               any_value(citation)    AS citation,
               max(trust)             AS trust
        FROM   workspace.meddesert.facility_capability
        WHERE  {where} {missing_clause}
        GROUP  BY name
        ORDER  BY state, city, name
        """
        rows = self._run_sql(sql, params)
        return [
            Facility(
                name=str(r.get("name") or ""),
                city=str(r.get("city") or ""),
                state=str(r.get("state") or ""),
                postcode=_str_or_none(r.get("postcode")),
                latitude=_float(r.get("latitude")),
                longitude=_float(r.get("longitude")),
                citation=_str_or_none(r.get("citation")),
                trust=str(r.get("trust") or "weak"),
            )
            for r in rows
            if r.get("name")
        ]

    def ensure_tables(self, cfg: Config) -> None:
        """Create enrichment tables if they don't exist. Idempotent."""
        ddl_images = f"""
        CREATE TABLE IF NOT EXISTS {cfg.images_table} (
          image_id            STRING NOT NULL,
          scrape_run_id       STRING,
          hospital_name       STRING NOT NULL,
          city                STRING,
          state               STRING,
          image_url           STRING,
          page_url            STRING,
          source_domain       STRING,
          source_tier         STRING,
          icu_probability     DOUBLE,
          match_score         DOUBLE,
          quality_score       DOUBLE,
          trust_score         DOUBLE,
          overall_confidence  DOUBLE,
          primary_image       BOOLEAN,
          width               INT,
          height              INT,
          file_size           BIGINT,
          sha256_hash         STRING,
          perceptual_hash     STRING,
          caption             STRING,
          alt_text            STRING,
          search_query        STRING,
          validation_notes    STRING,
          created_at          TIMESTAMP
        )
        USING DELTA
        COMMENT 'Verified hospital images found by the enrichment pipeline'
        """

        ddl_assets = f"""
        CREATE TABLE IF NOT EXISTS {cfg.map_assets_table} (
          hospital_name     STRING,
          city              STRING,
          state             STRING,
          primary_image_url STRING,
          primary_image_id  STRING,
          image_available   BOOLEAN,
          confidence        DOUBLE,
          gallery_count     INT,
          has_icu_image     BOOLEAN,
          updated_at        TIMESTAMP
        )
        USING DELTA
        COMMENT 'One row per hospital — the map popup reads this for fast lookup'
        """

        ddl_runs = f"""
        CREATE TABLE IF NOT EXISTS {cfg.scrape_runs_table} (
          run_id          STRING,
          started_at      TIMESTAMP,
          finished_at     TIMESTAMP,
          hospitals_input INT,
          hospitals_done  INT,
          images_accepted INT,
          images_rejected INT,
          avg_confidence  DOUBLE,
          notes           STRING
        )
        USING DELTA
        COMMENT 'One row per pipeline run — used for audit and incremental processing'
        """

        for ddl in [ddl_images, ddl_assets, ddl_runs]:
            self._run_sql(ddl.strip(), [])
        log.info("Enrichment tables verified/created.")

    def upsert_image(self, cfg: Config, rec: dict[str, Any]) -> None:
        """Insert or replace an image record (idempotent on image_id)."""
        merge = f"""
        MERGE INTO {cfg.images_table} AS t
        USING (SELECT
          :image_id          AS image_id,
          :scrape_run_id     AS scrape_run_id,
          :hospital_name     AS hospital_name,
          :city              AS city,
          :state             AS state,
          :image_url         AS image_url,
          :page_url          AS page_url,
          :source_domain     AS source_domain,
          :source_tier       AS source_tier,
          :icu_probability   AS icu_probability,
          :match_score       AS match_score,
          :quality_score     AS quality_score,
          :trust_score       AS trust_score,
          :overall_confidence AS overall_confidence,
          :primary_image     AS primary_image,
          :width             AS width,
          :height            AS height,
          :file_size         AS file_size,
          :sha256_hash       AS sha256_hash,
          :perceptual_hash   AS perceptual_hash,
          :caption           AS caption,
          :alt_text          AS alt_text,
          :search_query      AS search_query,
          :validation_notes  AS validation_notes,
          current_timestamp() AS created_at
        ) AS s ON t.image_id = s.image_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
        params = [{"name": k, "value": _sql_val(v), "type": "STRING"} for k, v in rec.items()]
        self._run_sql(merge, params)

    def upsert_map_asset(self, cfg: Config, asset: dict[str, Any]) -> None:
        """Upsert the map popup record for a hospital (keyed on name+city+state)."""
        merge = f"""
        MERGE INTO {cfg.map_assets_table} AS t
        USING (SELECT
          :hospital_name      AS hospital_name,
          :city               AS city,
          :state              AS state,
          :primary_image_url  AS primary_image_url,
          :primary_image_id   AS primary_image_id,
          :image_available    AS image_available,
          :confidence         AS confidence,
          :gallery_count      AS gallery_count,
          :has_icu_image      AS has_icu_image,
          current_timestamp() AS updated_at
        ) AS s ON t.hospital_name = s.hospital_name
                AND t.city = s.city AND t.state = s.state
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
        params = [{"name": k, "value": _sql_val(v), "type": "STRING"} for k, v in asset.items()]
        self._run_sql(merge, params)

    def finish_run(self, cfg: Config, run: dict[str, Any]) -> None:
        self._run_sql(
            f"""
            MERGE INTO {cfg.scrape_runs_table} AS t
            USING (SELECT
              :run_id            AS run_id,
              current_timestamp() AS finished_at,
              :hospitals_input   AS hospitals_input,
              :hospitals_done    AS hospitals_done,
              :images_accepted   AS images_accepted,
              :images_rejected   AS images_rejected,
              :avg_confidence    AS avg_confidence,
              :notes             AS notes
            ) AS s ON t.run_id = s.run_id
            WHEN MATCHED THEN UPDATE SET
              t.finished_at     = s.finished_at,
              t.hospitals_input = s.hospitals_input,
              t.hospitals_done  = s.hospitals_done,
              t.images_accepted = s.images_accepted,
              t.images_rejected = s.images_rejected,
              t.avg_confidence  = s.avg_confidence,
              t.notes           = s.notes
            WHEN NOT MATCHED THEN INSERT
              (run_id, started_at, finished_at, hospitals_input, hospitals_done,
               images_accepted, images_rejected, avg_confidence, notes)
            VALUES
              (s.run_id, current_timestamp(), s.finished_at, s.hospitals_input,
               s.hospitals_done, s.images_accepted, s.images_rejected,
               s.avg_confidence, s.notes)
            """,
            [{"name": k, "value": _sql_val(v), "type": "STRING"} for k, v in run.items()],
        )

    # ── internal ──────────────────────────────────────────────────────────

    def _run_sql(self, statement: str, params: list[dict]) -> list[dict]:
        body: dict[str, Any] = {
            "warehouse_id": self._warehouse,
            "statement": statement,
            "wait_timeout": "50s",
            "on_wait_timeout": "CONTINUE",
            "format": "JSON_ARRAY",
            "disposition": "INLINE",
        }
        if params:
            body["parameters"] = params

        resp = self._session.post(f"{self._host}/api/2.0/sql/statements", json=body, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        stmt_id = data.get("statement_id")
        state = data.get("status", {}).get("state")
        deadline = time.time() + self._DEADLINE_S

        while state in ("PENDING", "RUNNING") and time.time() < deadline:
            time.sleep(self._POLL_INTERVAL)
            r = self._session.get(
                f"{self._host}/api/2.0/sql/statements/{stmt_id}", timeout=30
            )
            r.raise_for_status()
            data = r.json()
            state = data.get("status", {}).get("state")

        if state != "SUCCEEDED":
            msg = data.get("status", {}).get("error", {}).get("message", f"state={state}")
            raise RuntimeError(f"Databricks SQL failed: {msg}")

        columns = [c["name"] for c in data.get("manifest", {}).get("schema", {}).get("columns", [])]
        rows = data.get("result", {}).get("data_array") or []
        return [dict(zip(columns, row)) for row in rows]


# ── helpers ────────────────────────────────────────────────────────────────

def _float(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _str_or_none(v: Any) -> str | None:
    s = str(v).strip() if v is not None else ""
    return s if s and s.lower() not in ("none", "null", "nan") else None


def _sql_val(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)
