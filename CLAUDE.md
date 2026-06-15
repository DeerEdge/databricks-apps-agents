# CLAUDE.md — Engineering Standards

Senior-engineering standards for this repo. These are **mandatory**, not aspirational.
Read this before writing or pushing code.

## Project Context

**Medical Desert Planner** — a social-impact, agentic data application for the Databricks
"Apps & Agents for Good" hackathon (Free Edition). A non-technical health planner selects a
clinical **capability** (ICU, maternity, emergency, oncology, trauma, NICU) and a geography,
and the app maps **regional care-gap scores** across India — crucially **distinguishing real
capability gaps from data-poor regions** by weighing facility supply against NFHS-5
demand-side burden. Every claim, score, and ranking is **cited to the underlying facility
free-text**; uncertainty is communicated honestly via per-facility trust signals; and the
planner can drill into facility records and **persist planning scenarios**. Scope: **India at
state → district granularity**. Primary user is a non-technical institutional planner/funder.

Built on the Databricks Marketplace **`databricks_virtue_foundation_dataset_dais_2026`**
dataset (≈10k facilities + India PIN directory + NFHS-5 district health indicators), with
gold tables in **`workspace.meddesert`**.

**Scoring is transparent, inspectable formula — NOT machine learning.** Gap scores come from
configurable formulas over known statistics (facility supply, NFHS-5 burden). Do **not**
introduce an ML model for the core scoring.

### Tech stack
- **Frontend + backend:** Next.js — snappy map UI plus API routes as the backend endpoints.
  No separate server framework. Deployed as a **Databricks App** on Free Edition.
- **Databricks access:** direct REST where simplest — **SQL Statement Execution API**
  (parameterized), **Genie Conversation API**, **Mosaic AI Model Serving** (agent endpoint).
- **Analytical data + AI:** Databricks Lakehouse (Delta bronze/silver/gold + Unity Catalog
  lineage); Genie for NL Q&A; Mosaic AI Agent Framework (GA) for reasoning. Agent Bricks is
  **not** on Free Edition — do not depend on it.
- **Persistence:** user actions (saved scenarios, notes, shortlists) persist via **Lakebase**.

The web app sends requests to Next.js backend endpoints; heavy data work and AI run on
Databricks.

## Push & Repo Safety (read before every push)

- **Never commit secrets.** No tokens, bearer credentials, `.env`, Databricks PATs,
  Delta Sharing credential files, or connection strings. Verify `.gitignore` covers them.
- **Review the full diff before committing.** Know exactly what is being added.
- **Never push directly to the default branch.** Branch, then open a PR.
- **Only commit or push when explicitly asked.** Do not auto-push.
- **No generated artifacts, data dumps, or large binaries** in git.
- Commits must be scoped and have clear messages explaining *why*, not just *what*.

## Security Standards (high bar — non-negotiable)

- **Parameterize all queries.** Never build SQL by string-concatenating user input —
  this applies to the SQL Statement Execution API and any NL passed toward Genie.
  Treat all external input as hostile until validated.
- **Validate and sanitize every input** at the boundary (API routes, agent tool inputs).
- **Least-privilege credentials.** Scope Databricks tokens to the minimum needed.
  Enforce access with Unity Catalog; never bypass governance.
- **No secrets in code, logs, or error messages.** Load from env / secret store only.
- **Never log PII or sensitive data.** If the domain involves personal data
  (health, location of vulnerable communities, etc.), minimize, de-identify, and
  document what is stored and why.
- **Server-side only for privileged calls.** Databricks tokens never reach the browser;
  all authenticated Databricks calls go through the backend.
- Fail **closed**, not open: on auth/permission errors, deny — never fall back to
  broader access.

## Performance & Query Optimization

- **No N+1 queries.** Fetch sets in one query with a join or `IN (...)`; never loop
  per-row to issue a query per item. Review every loop that touches the DB for this.
- **Batch and paginate.** The Statement Execution API returns large results in chunks —
  handle chunking; never assume one response holds everything.
- **Respect the Genie rate limit (~5 questions/min/workspace on Free Edition).**
  Cache or pre-compute hot queries; do not call Genie in a tight loop.
- **Account for SQL warehouse cold-start (seconds).** Don't put a warehouse round-trip
  on a latency-critical user path; use the OLTP store for that, and pre-warm before demos.
- Select only needed columns; push filters down to the query. No `SELECT *` in app code.
- Cache deterministic / expensive results where correctness allows.

## Code Quality — Concise & Clear

- **Write code that reads like the surrounding code.** Match existing naming, structure,
  and comment density.
- Prefer the smallest change that fully solves the problem. No speculative abstraction.
- Functions do one thing; names say what they do. Delete dead code rather than commenting it out.
- Comments explain *why*, not *what*. Keep them accurate or remove them.
- No silent failures: handle errors explicitly, surface them, don't swallow exceptions.

## Testing (mandatory — test every single component)

Testing is not optional and not an afterthought. **Every component gets tested, properly,
in isolation** — there are no exceptions for "small" or "obvious" code.

- **Every feature and bugfix ships with tests.** A feature is **not "done"** until its tests
  exist and pass. Don't mark work complete, commit, or open a PR otherwise.
- **Test each unit in isolation:**
  - *Pure logic* (e.g. the simulation engine) → exhaustive unit tests: happy path, boundaries
    (zero/empty/extreme inputs), and every branch. Pure functions have no excuse for gaps.
  - *API routes* → test success + failure responses with the Databricks client mocked.
  - *Data client* → test parameterization, error surfacing, and polling/timeout paths.
  - *UI components* → test render + interaction (state changes, form submission, edge states).
  - *Ingestion* → validate output: row counts, county coverage, no nulls in keys, types.
- Cover the happy path **and** failure modes, including security-relevant inputs (injection,
  auth failure, malformed payloads).
- **Run the tests before claiming anything works.** Report real output — never assert
  "passing" without having run it. Evidence before assertions, always.

## Skills — use them, every time

We have skills that encode HOW we build well. They are not ceremony — they are how we
genuinely **understand** what we're building and implement features **thoroughly** rather than
shallowly. If there's even a chance a skill applies, invoke it **before** acting.

- **Designing a feature / changing behavior** → `brainstorming` first (explore intent,
  constraints, and the design) before any code.
- **Writing code** → `test-driven-development` (red → green → refactor).
- **Building UI** → `frontend-design` (distinctive, production-grade, not generic).
- **Chasing a bug or unexpected behavior** → `systematic-debugging` before proposing fixes.
- **Planning multi-step work** → `writing-plans`; **executing a plan** → the executing skills.
- **Before declaring done** → `verification-before-completion`: run it, show the output.

Process skills come first (they determine HOW we approach the task), implementation skills
second. Use the skill fully — don't adapt away its discipline. Shallow implementation is a
failure mode these skills exist to prevent.

## Reference: What "Open Sharing" Is

**Open Sharing** is the open mode of the **Delta Sharing** protocol — Databricks' open
standard for sharing live data (and, more recently, agent skills) **across organizations
with zero data copying**. The data provider grants access to Delta tables; the recipient
reads directly from the provider's storage, so no duplicate copy is made and the data
stays current.

- **Open sharing mode:** share with *any* recipient, including those **not on Databricks**,
  using a **credential file containing a bearer token**. Recipients consume the share from
  any tool that supports the protocol (pandas, Spark, etc.).
- **Databricks-to-Databricks mode:** both sides are on Databricks; access is governed
  end-to-end by Unity Catalog without a credential file.

Why it matters here: it enables cross-org data/skill collaboration (NGOs, hospitals, cities)
without vendor lock-in or copying sensitive datasets. Every shared access is governed and
auditable via Unity Catalog. If we use it, treat credential files as secrets (see Security).
