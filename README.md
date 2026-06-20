# MedIndia

Analyze messy health records and surface critical healthcare information to help coordinators
make equitable data-backed decisions.

<div align="center">
  <img src="medindia-map.gif" alt="MedIndia map and planner" width="800"/>
  <br/>
  <img src="medindia-maya.gif" alt="Maya referral copilot" width="800"/>
  <br/>
</div>

## Live app

**https://meddesert.kabirsinghct.workers.dev**

No login required — open the link and explore.

### What to try

Switch the clinical **capability**; click a **state** to see its care-gap score and the **facility
records + citations** behind it (note the trust signals and the **real-gap vs data-poor**
distinction); ask the **planner agent** a question like *"Worst ICU gaps in India?"* for Genie-backed
analysis and charts; visit **Maya** at `/referral` for the referral copilot; **save a planning
scenario** and **shortlist a facility** — these persist via Lakebase, so reload to confirm they're
still there.

## Stack

Next.js (App Router, TypeScript) on **Cloudflare Workers** · MapLibre GL choropleth · Databricks
Lakehouse (`workspace.meddesert`, via the SQL Statement Execution API) · **Lakebase** (Postgres)
for persistence · Databricks Genie (planner agent) · Mosaic AI (Maya referral copilot). Gap scoring
is a **transparent, inspectable formula — not machine learning**.

See `spec.md` (architecture + data model), `features.md` (feature tracker), and `CLAUDE.md`
(engineering standards).

## Deploy (maintainers)

```bash
npm run cf:deploy
```

Requires `wrangler login` and secrets (`DATABRICKS_TOKEN`, `LAKEBASE_USER`, `CEREBRAS_API_KEY`).
Non-secret env vars live in `wrangler.jsonc`.
