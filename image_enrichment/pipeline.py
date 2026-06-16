"""Hospital image enrichment pipeline.

Simplified approach: for each facility, find one representative photo from
Wikipedia and store its URL directly in the Delta tables.  No downloading
or AI validation required — the browser loads images from the CDN.
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import Config
from .databricks_client import DatabricksClient, Facility
from .search import ImageSearcher

log = logging.getLogger(__name__)


@dataclass
class RunStats:
    run_id: str
    started_at: datetime
    hospitals_input: int = 0
    hospitals_done: int = 0
    images_accepted: int = 0
    images_rejected: int = 0
    confidences: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def avg_confidence(self) -> float:
        return sum(self.confidences) / len(self.confidences) if self.confidences else 0.0


class ImageEnrichmentPipeline:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.dbx = DatabricksClient(cfg)
        self.searcher = ImageSearcher(cfg)

    def run(
        self,
        capability: str = "icu",
        state: str | None = None,
        only_missing: bool = False,
    ) -> RunStats:
        run_id = str(uuid.uuid4())
        stats = RunStats(run_id=run_id, started_at=datetime.now(timezone.utc))

        log.info("Pipeline run %s starting", run_id)
        self.dbx.ensure_tables(self.cfg)

        self.dbx.finish_run(self.cfg, {
            "run_id": run_id,
            "hospitals_input": 0, "hospitals_done": 0,
            "images_accepted": 0, "images_rejected": 0,
            "avg_confidence": 0.0,
            "notes": f"capability={capability} state={state or 'all'}",
        })

        facilities = self.dbx.load_facilities(
            capability=capability,
            state=state,
            only_missing=only_missing,
            images_table=self.cfg.images_table,
        )
        stats.hospitals_input = len(facilities)
        log.info("Loaded %d facilities", len(facilities))

        if not facilities:
            log.warning("No facilities to process.")
            return stats

        max_w = min(self.cfg.max_workers, len(facilities))
        with ThreadPoolExecutor(max_workers=max_w) as pool:
            futures = {
                pool.submit(self._enrich_hospital, fac, run_id, stats): fac
                for fac in facilities
            }
            for fut in as_completed(futures):
                fac = futures[fut]
                try:
                    fut.result()
                except Exception as e:
                    log.error("Failed hospital '%s': %s", fac.name, e)
                    stats.errors.append(f"{fac.name}: {e}")

        stats.hospitals_done = stats.hospitals_input - len(stats.errors)

        self.dbx.finish_run(self.cfg, {
            "run_id": run_id,
            "hospitals_input": stats.hospitals_input,
            "hospitals_done": stats.hospitals_done,
            "images_accepted": stats.images_accepted,
            "images_rejected": stats.images_rejected,
            "avg_confidence": stats.avg_confidence,
            "notes": f"capability={capability} state={state or 'all'} errors={len(stats.errors)}",
        })

        log.info("Run %s complete — %d accepted, %d rejected",
                 run_id, stats.images_accepted, stats.images_rejected)
        return stats

    def _enrich_hospital(self, fac: Facility, run_id: str, stats: RunStats) -> None:
        log.info("Processing '%s' (%s, %s)", fac.name, fac.city, fac.state)

        # Get the first usable Wikipedia image URL — no downloading required
        result = self.searcher.get_wikipedia_image(fac.name, fac.city, fac.state)

        if result:
            image_url, article_title = result
            image_id = str(uuid.uuid4())
            log.info("  ✓ Found image for '%s': %s", fac.name, image_url[:80])

            # Write a lightweight record to hospital_images
            self.dbx.upsert_image(self.cfg, {
                "image_id": image_id,
                "scrape_run_id": run_id,
                "hospital_name": fac.name,
                "city": fac.city,
                "state": fac.state,
                "image_url": image_url,
                "page_url": f"https://en.wikipedia.org/wiki/{article_title.replace(' ','_')}",
                "source_domain": "upload.wikimedia.org",
                "source_tier": "tier3",
                "icu_probability": 0.0,
                "match_score": 0.80,
                "quality_score": 0.80,
                "trust_score": 0.60,
                "overall_confidence": 0.80,
                "primary_image": True,
                "width": 0, "height": 0, "file_size": 0,
                "sha256_hash": "", "perceptual_hash": "",
                "caption": f"From Wikipedia: {article_title}",
                "alt_text": article_title,
                "search_query": f"{fac.name} Wikipedia",
                "validation_notes": f"Wikipedia article: {article_title}",
            })

            self.dbx.upsert_map_asset(self.cfg, {
                "hospital_name": fac.name,
                "city": fac.city,
                "state": fac.state,
                "primary_image_url": image_url,
                "primary_image_id": image_id,
                "image_available": True,
                "confidence": 0.80,
                "gallery_count": 1,
                "has_icu_image": False,
            })
            stats.images_accepted += 1
            stats.confidences.append(0.80)
        else:
            log.info("  ✗ No Wikipedia image found for '%s'", fac.name)
            self.dbx.upsert_map_asset(self.cfg, {
                "hospital_name": fac.name,
                "city": fac.city,
                "state": fac.state,
                "primary_image_url": None,
                "primary_image_id": None,
                "image_available": False,
                "confidence": 0.0,
                "gallery_count": 0,
                "has_icu_image": False,
            })
            stats.images_rejected += 1
