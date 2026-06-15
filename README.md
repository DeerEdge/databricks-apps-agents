# Medical Desert Planner — India

A non-technical health planner picks a clinical **capability** (ICU, maternity, emergency,
oncology, trauma, NICU) and a geography, and the app maps **regional care-gap scores** across
India — distinguishing **real capability gaps from data-poor regions** by weighing facility
supply against **NFHS-5 demand-side burden**. Every claim, score, and ranking is **cited to the
underlying facility free-text**; uncertainty is shown via per-facility trust signals; and the
planner can drill into facility records and save planning scenarios. Built for the Databricks
"Apps & Agents for Good" hackathon (Free Edition), deployed as a **Databricks App**.

> Gap scoring is a **transparent, inspectable formula, not machine learning** — supply and
> NFHS-5 burden combine via configurable rules (`src/lib/meddesert.ts` + the `region_gap` view).

## Stack

- **Next.js (App Router, TS)** — UI + API routes (the backend). No separate server.
- **MapLibre GL** — India state choropleth (free CARTO basemap, no token).
- **Databricks Lakehouse** — Delta tables + Unity Catalog (`workspace.meddesert`), reached via
  the **SQL Statement Execution API**; **Genie Conversation API** for NL Q&A; **Lakebase** for
  persisted planning scenarios.
- Hand-built CSS design system; **vitest** for unit tests.

## Architecture

```
SOURCES (Virtue Foundation Marketplace)  → Databricks gold      → Next.js API     → React UI
  facilities (~10k, free-text)             workspace.meddesert     /api/regions      Gap map +
  india_post_pincode_directory             facility_base           /api/facilities   ranked gaps +
  nfhs_5_district_health_indicators        facility_capability     /api/health       evidence panel
                                           region_burden/coverage/gap (views)
```

- **Data layer = Delta in Unity Catalog** (source of truth). Evidence extraction (facility
  free-text → trust signal + citation) and the gap model run **server-side** in Databricks.
- **`region_gap`** scores each state×capability as `need × scarcity`, flagging `data_poor`
  regions (no evidence / <10 facilities / no NFHS need data) so real gaps aren't confused with
  sparse data.

## Setup

```bash
npm install
cp .env.template .env.local   # fill in Databricks values
```

`.env.local` (never committed — see `.gitignore`):

| Var | Required | Notes |
|---|---|---|
| `DATABRICKS_HOST` | yes | `https://<workspace>.cloud.databricks.com` |
| `DATABRICKS_TOKEN` | yes | PAT (server-only; rotate after the hackathon) |
| `DATABRICKS_WAREHOUSE_ID` | yes | SQL warehouse id |
| `DATABRICKS_GENIE_SPACE_ID` | optional | a Genie space over `workspace.meddesert` (enables Genie mode) |
| `NEXT_PUBLIC_MAP_STYLE_URL` | optional | blank = free CARTO basemap |

## Build gold tables in Databricks

```bash
python3 scripts/ingest_facilities.py
```

Builds `workspace.meddesert`: `facility_base`, `facility_capability` (facility × capability →
trust signal + cited text), and the `region_burden` / `region_coverage` / `region_gap` views.

## Run / test

```bash
npm run dev     # http://localhost:3000  (warehouse cold-starts on first query, ~10–30s)
npm test        # vitest unit tests (pure logic: normalizeState, gapColor, trustLabel, …)
npm run build   # production build
```

## Repo safety

No secrets in git: `.env*.local` is gitignored; Databricks tokens are read server-side only and
never reach the browser; all SQL is parameterized. See `CLAUDE.md` for the full standards.

## Project docs

- `spec.md` — application spec (architecture, data model, evidence/trust model, demo plan).
- `features.md` — living feature tracker + roadmap.
- `CLAUDE.md` — engineering standards (security, testing, performance).
