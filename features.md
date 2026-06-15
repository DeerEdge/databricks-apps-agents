# features.md — Medical Desert Planner Feature Tracker

> Living log of features: what's built, what's in progress, what's next. Entries are small
> and specific so a `/loop` session can pick the next item, plan it, execute it, check it off.
> Update status as work progresses.

**Status legend:** ✅ done · 🚧 in progress · 📋 todo · ⛔ blocked

## Project

**Medical Desert Planner** — Databricks "Apps & Agents for Good" (Track 2). A non-technical
health planner picks a clinical **capability** (ICU, maternity, emergency, oncology, trauma,
NICU) + a geography, and the app maps **regional care-gap scores** across India —
distinguishing **real capability gaps from data-poor regions** by weighing facility supply
against NFHS-5 demand-side burden. Every claim/score/ranking is **cited to the underlying
facility free-text**; uncertainty is communicated via per-facility trust signals; the planner
drills into facility records and **persists planning scenarios**.

- Repo: github.com/DeerEdge/databricks-apps-agents. Next.js, deployed as a Databricks App (Free Edition).
- Dataset: `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset`
  (facilities ≈10,088, `india_post_pincode_directory`, `nfhs_5_district_health_indicators`).
  Gold tables in `workspace.meddesert`.
- **Judging:** product judgment · evidence + uncertainty · technical execution · ambition.

## Roadmap

- [x] **MD1 — data foundation.** `ingest_facilities.py` → `meddesert.facility_base` +
      `facility_capability` (facility × {icu,maternity,emergency,oncology,trauma,nicu} →
      trust signal + cited facility text). All compute server-side. Verified trust
      distributions + real citations.
- [x] **MD2 — regional gap model.** `region_burden` (NFHS-5 → state, cleaned) +
      `region_coverage` (trust-weighted supply per state×capability) + `region_gap` view
      (need × scarcity → gap_score, data_poor) + `/api/regions?capability=`. `data_poor` =
      no evidence / <10 facilities / no NFHS need data — honestly separates real gaps from
      data-poor regions. Verified: top ICU/maternity gaps = Meghalaya, Manipur, Jharkhand,
      Bihar (real states, real need). Known limit: state field is messy (cities mixed in) →
      district-level via PIN/point-in-polygon is the real fix (MD2b).
- [x] **MD3 — gap map.** India state choropleth (geoBoundaries ADM1, diacritic-normalized
      join) colored by gap score; capability tabs; legend; right-rail ranked "real care gaps"
      list + selected-state panel (`MedDesertPlanner` + `GapMap`). `meddesert.ts` pure
      (`normalizeState`/`gapColor`/`trustLabel`) + tests. Verified in browser (ICU:
      Meghalaya/Manipur/Jharkhand/Bihar red; data-poor greyed; click→select works).
- [x] **MD4 — evidence drill-in.** Region → facility records with trust badges + citations.
      `/api/facilities?capability=&state=` + selected-state evidence panel (trust badge, cited
      facility text, source tags). `trustClass` pure + tests. Browser-verified (Meghalaya ICU:
      "Has 14 ICU beds" strong, etc.).
- [x] **MD5 — persist scenarios (Lakebase).** Provisioned a Lakebase Postgres instance
      (`meddesert`, PG 16); `src/lib/lakebase.ts` mints a short-lived DB credential from the
      Databricks token (cached, auto-refresh), connects over verified TLS, auto-creates
      `saved_scenario`. `/api/scenarios` GET/POST/DELETE; `scenario.ts` validates + clamps input
      (pure, 9 tests). UI: save-with-note in the selected panel + persisted scenarios list with
      delete + click-to-reopen. Verified live: POST→GET round-trip, persistence across reload,
      delete, 400 on bad capability, injection string stored literally (parameterized).
- [ ] **MD6 — agent.** NL "where are ICU gaps in Bihar?" grounded in the evidence/region tables.
- [ ] **MD7 — deploy as a Databricks App** (`app.yaml`) on Free Edition; non-technical polish.
- [ ] **MD2b — district granularity.** Map facilities to district via PIN /
      point-in-polygon so coverage isn't blurred by the messy state field.

> **Loop operating constraints (user, 2026-06-15):** be token-efficient — terse replies,
> minimal tool calls, skip browser screenshots on low-risk (CSS/text) changes; reserve full
> Playwright verification for risky map/UI work. Loop interval = 3 min. Context auto-compacts
> via the harness when large.

## Per-Feature Detail

_Add a short block here for anything non-trivial before a loop session executes it._

### MD4 — evidence drill-in
- **Goal:** clicking a state shows the facilities behind its gap score, each with a trust
  badge and the cited facility text — so a non-technical user can verify any claim.
- **Approach:** `/api/facilities` returns `facility_capability` rows (trust ≠ none) ordered
  strong→partial→weak; the selected-state panel renders badges + citations.
- **Tests required:** API success/failure (Databricks mocked), parameterization, trust
  ordering; panel render + empty/loading states.
