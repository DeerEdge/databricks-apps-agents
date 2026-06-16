# Medical Desert Planner — India

A **Databricks App** for the "Apps & Agents for Good" hackathon (Free Edition). A non-technical
health planner picks a clinical **capability** (ICU, maternity, emergency, oncology, trauma,
NICU) and a geography, and the app maps **regional care-gap scores** across India —
distinguishing **real capability gaps from data-poor regions** using NFHS-5 demand-side burden.
Every score is **cited to the underlying facility free-text**, uncertainty is shown via
per-facility **trust signals**, and planners can drill into facility records, **save planning
scenarios**, and **shortlist facilities** (persisted via Lakebase).

## Live app — judge access

**https://meddesert-7474653569700804.aws.databricksapps.com**

Databricks Apps are always login-gated (they can't be made public), and Free Edition signs in
with a **one-time code emailed to the account**. We've set up a dedicated demo Google account so
you can retrieve that code:

- **Demo Gmail:** `databrickstest2026@gmail.com`
- **Gmail password:** `databricks2026`

### How to log in (about 1 minute)

1. Sign in to Gmail at https://mail.google.com with the demo account above — keep the tab open.
2. Open the app: **https://meddesert-7474653569700804.aws.databricksapps.com**
3. At the Databricks sign-in page, enter `databrickstest2026@gmail.com` and continue. A
   **6-character one-time code** is emailed to that inbox.
4. Switch back to the Gmail tab, open the new email from Databricks, and copy the code.
5. Paste it into the app and submit — the Medical Desert Planner loads.

> If the code email is slow, refresh the Gmail inbox; it usually arrives within a few seconds.

### What to try

Switch the clinical **capability**; click a **state** to see its care-gap score and the
**facility records + citations** behind it (note the trust signals and the **real-gap vs
data-poor** distinction); **save a planning scenario** and **shortlist a facility** — these
persist via Lakebase, so reload to confirm they're still there.

## Stack

Next.js (App Router, TypeScript) UI + API routes · MapLibre GL choropleth · Databricks
Lakehouse (`workspace.meddesert`, via the SQL Statement Execution API) · **Lakebase** (Postgres)
for persistence. Gap scoring is a **transparent, inspectable formula — not machine learning**.

See `spec.md` (architecture + data model), `features.md` (feature tracker), and `CLAUDE.md`
(engineering standards).
