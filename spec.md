# spec.md — Medical Desert Planner

> Living spec — the single source of truth for *what* we're building and *why*.
> Status: core architecture + data model + evidence/trust model locked; persistence, agent,
> and demo flow being finalized (see Open Questions).

## 1. Overview

The Medical Desert Planner is a map-based analysis tool that helps a non-technical health
planner find where India lacks a given **clinical capability** — and, critically, tells apart
**real capability gaps from data-poor regions**. It maps regional **care-gap scores** built
from facility supply weighed against **NFHS-5 demand-side burden**, cites the underlying
facility free-text behind every score, communicates uncertainty honestly, lets the user drill
into facility records, and persists planning scenarios.

- **Problem statement:** Public facility data is messy and uneven. A planner looking for "where
  do we lack ICU / maternity / trauma capacity?" can't tell whether a quiet region is genuinely
  underserved or simply under-reported — so funding decisions are made blind.
- **Target users / beneficiaries:** Institutional decision-makers — a non-technical health
  planner/funder, and a semi-technical agency planner.
- **Impact in one sentence:** Show *where* a clinical capability is genuinely missing (not just
  unrecorded), with the evidence to back it, so limited funding goes where need is real.

## 2. Goals & Non-Goals

**Goals**
- A regional (state → district) **care-gap map** per clinical capability across India.
- Honest separation of **real gaps vs data-poor regions** (the `data_poor` flag).
- **Evidence-cited** scores: every claim/ranking traces to specific facility free-text.
- **Uncertainty communicated** via per-facility trust signals (strong/partial/weak/none).
- Drill-in to facility records + **persisted planning scenarios** (Lakebase).
- An agent + Genie interface for plain-English questions grounded in the gold tables.

**Non-Goals (explicitly cut for the hackathon)**
- Machine-learning prediction — gap scoring is transparent calculation only.
- Patient-level or clinical decision support.
- Non-India scope.
- Asserting precise capacity counts where the source data can't support them (we surface
  uncertainty instead).

## 3. User Stories / Core Flows

- As a **planner**, I pick a capability (e.g. ICU) and see which states have the worst real
  care gaps — with data-poor regions visibly distinguished, not hidden.
- As a **planner**, I click a state and see the facilities behind its score, each with a trust
  badge and the cited text, so I can verify the claim myself.
- As a **funder**, I save a capability×geography shortlist with notes as a planning scenario I
  can revisit and revise.
- As either user, I ask a plain-English question ("where are ICU gaps in Bihar?") and get a
  grounded answer with supporting data.

## 4. Architecture

```
SOURCES                              → [ Databricks gold ]       → [ Next.js ]        → [ React UI ]
  facilities (~10k, free-text)         workspace.meddesert          /api/regions         gap map +
  india_post_pincode_directory         facility_base                /api/facilities      ranked gaps +
  nfhs_5_district_health_indicators    facility_capability          /api/health          evidence panel +
                                       region_burden/coverage/gap   (Lakebase writes)    saved scenarios
                                       (Unity Catalog governs + lineage)
```

- **Frontend + backend:** Next.js (UI + API routes). Deployed as a **Databricks App**.
- **Analytical / Lakehouse layer:** Delta + Unity Catalog. Evidence extraction (free-text →
  trust + citation) and the gap model run **server-side** in Databricks.
- **App state (OLTP):** **Lakebase** for persisted planning scenarios/notes/shortlists.
- **Agents / AI:** Genie space over gold tables (NL Q&A); Mosaic AI agent endpoint (reasoning).
- **Databricks access:** REST — SQL Statement Execution (parameterized), Genie Conversation,
  Model Serving.

## 5. Data Model

**Source dataset:** `databricks_virtue_foundation_dataset_dais_2026` (Virtue Foundation,
Databricks Marketplace) — `virtue_foundation_dataset` (≈10,088 facilities with free-text
specialty/description fields), `india_post_pincode_directory`, `nfhs_5_district_health_indicators`.

**Gold tables/views (`workspace.meddesert`):**
| Object | Type | Notes |
|---|---|---|
| `facility_base` | Delta | one row per facility: name, city, state, coords, specialty/claim/text fields |
| `facility_capability` | Delta | facility × {icu,maternity,emergency,oncology,trauma,nicu} → trust + cited text |
| `region_burden` | View | NFHS-5 indicators rolled to state (cleaned, diacritic-normalized) |
| `region_coverage` | View | trust-weighted facility supply per state × capability |
| `region_gap` | View | `need × scarcity` → `gap_score`, with `data_poor` flag |

**Evidence / trust model (the core idea):** facility fields are *claims to be verified*, not
facts. For each (facility, capability) we derive a trust signal from what the facility's own
data supports:
- **strong** — structured specialty code AND (a claim field OR description text) agree.
- **partial** — structured XOR claim.
- **weak** — only free-text description mentions it.
- **none** — nothing supports the capability (excluded from coverage).
Each non-`none` row carries the **citation** (the facility text) backing it.

**Gap scoring (transparent):** `gap_score = need × scarcity`, where `need` comes from NFHS-5
burden (e.g. low institutional-birth %), and `scarcity` is inverse trust-weighted supply.
`data_poor = (strong + partial = 0) OR (n_facilities < 10) OR (NFHS need data missing)` — so a
region with no evidence is shown as *data-poor*, never as a confident "no gap".

## 6. Databricks Surface Used

- [x] SQL Statement Execution API (backend reads gold slices / fresh queries, parameterized)
- [x] Unity Catalog (governance + lineage)
- [x] Genie Conversation API (NL Q&A over gold tables)
- [x] Mosaic AI Model Serving (agent endpoint — reasoning/explanation)
- [x] Lakebase (persisted planning scenarios/notes/shortlists)
- [x] Databricks Apps (deployment target on Free Edition)
- [ ] Delta / Open Sharing (future / cross-org; not in hackathon scope)

## 7. Demo Plan

- **The "wow" moment:** pick a capability → national gap map lights up real gaps in red while
  data-poor states stay grey → click a red state → ranked facilities appear, each with a trust
  badge and the exact cited text → save the shortlist as a scenario → ask the agent "why is this
  a gap?" and get a grounded, cited answer.
- **Pre-warm / pre-compute:** pre-warm the SQL warehouse; cache the gold slice; pre-can a few
  Genie questions to respect the ~5 q/min rate limit.

## 8. Constraints & Risks

- **Free Edition:** single 2X-Small warehouse + cold start (mitigated by cached slices),
  Genie ~5 q/min (mitigated by caching / pre-canned answers), Agent Bricks unavailable (use
  Mosaic AI Agent Framework).
- **Messy state field:** the facility `address_stateOrRegion` field mixes cities and free-text,
  so state-level coverage is blurred — district-level mapping via PIN / point-in-polygon
  (MD2b) is the real fix.
- **Honesty:** we claim *gap ranking with cited evidence and explicit data-poverty*, not a
  precise census of clinical capacity.

## 9. Open Questions

- District-level granularity: PIN-directory join vs point-in-polygon — which is cleaner?
- Exact `need` weighting across NFHS-5 indicators per capability.
- Lakebase scenario schema (what a saved scenario captures).
- Final demo script + roles (who clicks what).
