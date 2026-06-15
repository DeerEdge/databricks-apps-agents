#!/usr/bin/env python3
"""
Medical Desert Planner — evidence foundation (Track 2).

Builds, in Databricks (no row fetch — all compute server-side):
  workspace.meddesert.facility_base       cleaned facility fields from the Virtue Foundation set
  workspace.meddesert.facility_capability  one row per facility × capability with a TRUST SIGNAL
                                           (strong/partial/weak/none) + a CITATION (the facility's
                                           own text that supports the claim).

Trust model (facilities are CLAIMS to verify, not ground truth):
  structured = the structured `specialties` codes include a matching specialty
  claim      = the `capability` claim-array mentions the capability
  text       = description/procedure/equipment mentions it
  strong  = structured AND (claim OR text)      — corroborated
  partial = structured XOR claim                — one solid source
  weak    = text only                           — vague / unverified
  none     = no mention
Citation = first matching quoted claim from `capability`, else a sentence from `description`.
"""

import json
import os
import time
import urllib.request

SRC = "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# capability -> (specialty-code substrings, keyword substrings)
CAPS = {
    "icu":       (["criticalcaremedicine"], ["icu", "intensive care"]),
    "maternity": (["obstetric", "gynecolog", "maternalfetal"], ["maternity", "obstetric", "labour ward", "labor ward", "childbirth", "delivery ward"]),
    "emergency": (["emergencymedicine"], ["emergency", "casualty", "accident and emergency", "24x7", "trauma center", "trauma centre"]),
    "oncology":  (["oncolog"], ["oncolog", "cancer", "chemotherapy", "radiotherapy", "tumour", "tumor"]),
    "trauma":    (["traumasurgery", "traumatology"], ["trauma"]),
    "nicu":      (["neonatolog"], ["nicu", "neonatal intensive", "neonatal icu"]),
}


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


ENV = load_env(os.path.join(ROOT, ".env.local"))
HOST, TOKEN, WID = ENV["DATABRICKS_HOST"], ENV["DATABRICKS_TOKEN"], ENV["DATABRICKS_WAREHOUSE_ID"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def run_sql(stmt):
    body = json.dumps({"warehouse_id": WID, "statement": stmt, "wait_timeout": "50s", "on_wait_timeout": "CONTINUE"}).encode()
    d = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{HOST}/api/2.0/sql/statements", data=body, method="POST",
        headers={**AUTH, "Content-Type": "application/json"}), timeout=90).read())
    sid, st = d.get("statement_id"), d.get("status", {}).get("state")
    deadline = time.time() + 150
    while st in ("PENDING", "RUNNING") and time.time() < deadline:
        time.sleep(1.2)
        d = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"{HOST}/api/2.0/sql/statements/{sid}", headers=AUTH), timeout=90).read())
        st = d.get("status", {}).get("state")
    if st != "SUCCEEDED":
        raise RuntimeError(f"SQL [{st}]: {d.get('status',{}).get('error',{}).get('message','')}\n  {stmt[:160]}")
    return d


def like_any(expr, subs):
    return "(" + " OR ".join(f"{expr} LIKE '%{s}%'" for s in subs) + ")"


def cap_select(key, specs, kws):
    spec_l = "lower(coalesce(specialties,''))"
    cap_l = "lower(coalesce(capability,''))"
    text_l = "lower(concat_ws(' ', coalesce(description,''), coalesce(procedure,''), coalesce(equipment,'')))"
    structured = like_any(spec_l, specs)
    claim = like_any(cap_l, kws)
    text = like_any(text_l, kws)
    # citation: first quoted capability claim containing a keyword, else a description sentence
    kw_alt = "|".join(kws).replace(" ", "\\\\s")
    cite = (f"coalesce(nullif(regexp_extract(coalesce(capability,''), '(?i)\"([^\"]*(?:{kw_alt})[^\"]*)\"', 1), ''), "
            f"nullif(regexp_extract(coalesce(description,''), '(?i)([^.]*(?:{kw_alt})[^.]*)\\\\.', 1), ''))")
    return f"""
      SELECT unique_id, name, address_stateOrRegion AS state, address_city AS city,
             address_zipOrPostcode AS postcode, latitude, longitude,
             '{key}' AS capability,
             {structured} AS structured, {claim} AS claim, {text} AS text_hit,
             CASE
               WHEN {structured} AND ({claim} OR {text}) THEN 'strong'
               WHEN ({structured} AND NOT ({claim} OR {text})) OR ({claim} AND NOT {structured}) THEN 'partial'
               WHEN {text} THEN 'weak'
               ELSE 'none'
             END AS trust,
             {cite} AS citation
      FROM {SRC}
    """


def main():
    print("→ schema", flush=True)
    run_sql("CREATE SCHEMA IF NOT EXISTS workspace.meddesert")

    print("→ facility_base", flush=True)
    run_sql(f"""
        CREATE OR REPLACE TABLE workspace.meddesert.facility_base AS
        SELECT unique_id, name, address_city AS city, address_stateOrRegion AS state,
               address_zipOrPostcode AS postcode, latitude, longitude,
               specialties, capability, procedure, equipment, description, source_urls
        FROM {SRC}
    """)

    print("→ facility_capability (6 capabilities × 10k facilities)", flush=True)
    union = "\nUNION ALL\n".join(cap_select(k, s, w) for k, (s, w) in CAPS.items())
    run_sql(f"CREATE OR REPLACE TABLE workspace.meddesert.facility_capability AS\n{union}")

    nfhs = SRC.replace("facilities", "nfhs_5_district_health_indicators")
    print("→ region_burden (NFHS-5 → state, cleaned)", flush=True)
    run_sql(f"""
        CREATE OR REPLACE VIEW workspace.meddesert.region_burden AS
        SELECT upper(trim(state_ut)) AS state_key,
               round(avg(try_cast(regexp_replace(institutional_birth_5y_pct, '[()*]', '') AS DOUBLE)), 1) AS institutional_birth,
               round(avg(try_cast(regexp_replace(hh_member_covered_health_insurance_pct, '[()*]', '') AS DOUBLE)), 1) AS insurance_pct,
               round(avg(try_cast(regexp_replace(population_below_age_15_years_pct, '[()*]', '') AS DOUBLE)), 1) AS pop_under15,
               count(*) AS districts
        FROM {nfhs} GROUP BY upper(trim(state_ut))
    """)

    print("→ region_coverage (trust-weighted supply per state × capability)", flush=True)
    run_sql("""
        CREATE OR REPLACE VIEW workspace.meddesert.region_coverage AS
        SELECT upper(trim(state)) AS state_key, any_value(state) AS state, capability,
               count(*) AS n_facilities,
               sum(CASE WHEN trust='strong' THEN 1 ELSE 0 END) AS strong,
               sum(CASE WHEN trust='partial' THEN 1 ELSE 0 END) AS partial,
               sum(CASE WHEN trust='weak' THEN 1 ELSE 0 END) AS weak,
               round(sum(CASE trust WHEN 'strong' THEN 1.0 WHEN 'partial' THEN 0.5 WHEN 'weak' THEN 0.2 ELSE 0 END), 1) AS supply
        FROM workspace.meddesert.facility_capability
        WHERE state IS NOT NULL AND trim(state) <> ''
        GROUP BY upper(trim(state)), capability
    """)

    print("→ region_gap (need × scarcity, data-poor flag)", flush=True)
    run_sql("""
        CREATE OR REPLACE VIEW workspace.meddesert.region_gap AS
        WITH cov AS (SELECT * FROM workspace.meddesert.region_coverage),
             maxs AS (SELECT capability, max(supply) max_supply FROM cov GROUP BY capability)
        SELECT c.state, c.state_key, c.capability, c.n_facilities, c.strong, c.partial, c.weak, c.supply,
               b.institutional_birth, b.insurance_pct, b.pop_under15,
               round(coalesce((100 - b.institutional_birth) / 100.0, 0.5), 3) AS need_index,
               round(1 - c.supply / nullif(m.max_supply, 0), 3) AS scarcity,
               round(coalesce((100 - b.institutional_birth) / 100.0, 0.5) * (1 - c.supply / nullif(m.max_supply, 0)), 3) AS gap_score,
               -- data-poor when: no real evidence, too few facilities, OR no NFHS demand-side
               -- data (which also filters out messy non-state values in the address field).
               ((c.strong + c.partial) = 0 OR c.n_facilities < 10 OR b.institutional_birth IS NULL) AS data_poor
        FROM cov c JOIN maxs m ON c.capability = m.capability
        LEFT JOIN workspace.meddesert.region_burden b ON c.state_key = b.state_key
    """)

    print("→ district_need (NFHS-5 demand-side need, district granularity)", flush=True)
    run_sql(f"""
        CREATE OR REPLACE VIEW workspace.meddesert.district_need AS
        SELECT upper(trim(state_ut)) AS state_key, state_ut AS state, district_name,
               round(try_cast(regexp_replace(institutional_birth_5y_pct, '[()*]', '') AS DOUBLE), 1) AS institutional_birth,
               round(try_cast(regexp_replace(hh_member_covered_health_insurance_pct, '[()*]', '') AS DOUBLE), 1) AS insurance_pct,
               round(coalesce((100 - try_cast(regexp_replace(institutional_birth_5y_pct, '[()*]', '') AS DOUBLE)) / 100.0, 0.5), 3) AS need_index
        FROM {nfhs}
        WHERE district_name IS NOT NULL AND trim(district_name) <> ''
    """)

    print("→ verify trust distribution", flush=True)
    rows = run_sql("""
        SELECT capability, trust, count(*) n
        FROM workspace.meddesert.facility_capability
        GROUP BY capability, trust ORDER BY capability, trust
    """)["result"]["data_array"]
    for r in rows:
        print(f"   {r[0]:10s} {r[1]:8s} {r[2]}", flush=True)
    print("✓ done", flush=True)


if __name__ == "__main__":
    main()
