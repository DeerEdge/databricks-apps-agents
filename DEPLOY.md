# Deploying Medical Desert Planner as a Databricks App (Free Edition)

This is the runbook to take the repo from local to a judge-accessible Databricks App. It
satisfies hackathon Rule 4.2 (App on Lakebase + ≥1 more Databricks tool) and Rule 4.3(b)
(judges get a working link / login).

Auth model: the deployed app uses a **Databricks PAT stored as an app secret** (not the
app service principal). `src/lib/databricks.ts` and `src/lib/lakebase.ts` already work this
way — no code change for deploy. The PAT and the Lakebase identity email are set at deploy
time and are **never committed** (this repo is public).

## 0. Prerequisites

```bash
# Databricks CLI (not yet installed in this environment)
brew install databricks            # or: curl -fsSL https://databricks.com/install.sh | sh
databricks auth login --host https://dbc-837977ce-19e0.cloud.databricks.com
```

## 1. Create the app

Workspace UI → **Compute → Apps → Create app → Custom** (name: `meddesert`), or:

```bash
databricks apps create meddesert
```

## 2. Set the secret and identity (never committed)

`app.yaml` references the PAT via `valueFrom: meddesert-token`. Create that secret and set
the Lakebase identity in the app's **Environment** tab:

```bash
# PAT — paste the dapi… token from .env.local (DATABRICKS_TOKEN)
databricks secrets create-scope meddesert 2>/dev/null || true
databricks secrets put-secret meddesert token   # then reference as meddesert-token resource
```

In the app **Environment** tab also add:
- `LAKEBASE_USER` = the email that owns the PAT (matches `.env.local`). Kept out of the repo.

> Free Edition note: if app *resources/secrets* aren't available, set `DATABRICKS_TOKEN` and
> `LAKEBASE_USER` directly as environment values in the app's Environment tab instead of
> `valueFrom`. They live only in the workspace, never in git.

## 3. Grants the PAT identity needs

The token's identity must be able to read the gold views and use Lakebase:

```sql
-- Unity Catalog (run in a SQL editor as a workspace admin)
GRANT USAGE ON CATALOG workspace TO `<pat-owner-email>`;
GRANT USAGE ON SCHEMA workspace.meddesert TO `<pat-owner-email>`;
GRANT SELECT ON SCHEMA workspace.meddesert TO `<pat-owner-email>`;
-- SQL warehouse 6c9078480dee0864: grant CAN_USE to the identity
```

Lakebase tables (`saved_scenario`, `facility_override`, `shortlist_facility`) are created on
first request by `ensureSchema()` in `src/lib/lakebase.ts`; the PAT owner already owns them.

## 4. Sync and deploy

```bash
databricks sync . /Workspace/Users/<your-email>/meddesert \
  --exclude node_modules --exclude .next --exclude '*.png' --exclude .env.local
databricks apps deploy meddesert \
  --source-code-path /Workspace/Users/<your-email>/meddesert
```

Databricks then runs `npm install → npm run build → npm run start`. Wait ~2-3 min.

## 5. Give judges access (Rule 4.3(b))

The app URL requires workspace auth. Two compliant options:
1. **Grant access**: app → Permissions → add the judges' Databricks accounts as `CAN_USE`.
2. **Login credentials in testing instructions** (Rule 4.3(b) explicitly allows this): put
   the app URL + a viewer login in the Devpost "testing instructions". Pair with the ≤3-min
   demo video (Rule 4.3(e)) as the primary walkthrough.

## 6. Verify

- Open the app URL → map renders, capability switch works.
- `GET /api/health` returns ok.
- Save a scenario and add a shortlist item → confirm they persist (Lakebase round-trip).

## Submission gate checklist (Rule 4.3)

- [x] Public open-source GitHub repo with a license (`LICENSE`, MIT)
- [x] Built only during the Project Period (first commit Jun 15, 1:13pm PT)
- [ ] Live app URL + judge access (this runbook)
- [ ] Demo video ≤3 min, public on YouTube/Vimeo
- [ ] Devpost text description of features + testing instructions
