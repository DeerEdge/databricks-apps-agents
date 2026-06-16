# STATUS.md — Medical Desert Planner

> Living project log. Update on every milestone completion, significant bug fix, or
> architectural decision. Keep entries dated and terse. See `CLAUDE.md` for update policy.

---

## Current State — 2026-06-16

**Build:** green. 103 tests pass (`npm test`). Production build clean.  
**Deployment:** `app.yaml` + `next start` on `0.0.0.0:$PORT` — Databricks App ready. `databricks apps deploy` is the final CLI step.  
**Milestones:** MD1 → MD14 all complete. Track 3 (Referral Copilot "Maya") in progress.

| Area | Status | Notes |
|---|---|---|
| Data foundation | ✅ | `facility_base` + `facility_capability` in `workspace.meddesert`; trust signals + citations verified |
| Regional gap model | ✅ | `region_gap` view: `need × scarcity`, `data_poor` flag; top gaps = Meghalaya/Manipur/Jharkhand/Bihar |
| District granularity | ✅ | PIN directory join: 9,563/10,088 (95%) facilities mapped to district; `district_gap` view |
| Gap map | ✅ | India state choropleth (MapLibre GL, geoBoundaries ADM1, diacritic-normalized join) |
| Evidence drill-in | ✅ | Facility records with trust badges + cited text per state×capability |
| Facility points on map | ✅ | Per-state points colored by trust; hover shows name + citation; map zooms to fit |
| Scenarios (Lakebase) | ✅ | GET/POST/DELETE `/api/scenarios`; auto-refresh credentials; injection-safe |
| Trust overrides | ✅ | Human corrections persisted to `facility_override`; both AI + planner assessments shown |
| Scenario brief | ✅ | Cited Markdown brief per scenario; one-click copy |
| Map↔evidence link | ✅ | Clicking facility point highlights its evidence card (pulse animation) |
| Transparency | ✅ | `explainGap` chain-of-thought; API meta strips (rows, latency, source, engine) |
| Planner agent | ✅ | `/api/ask` grounded NL: 4 intents (gap_in_state, top_gaps, data_poor, facility_evidence) |
| Ask UI | ✅ | Pill input, suggestion chips, animated reasoning card, grounded-answer card |
| Databricks App | ✅ | `app.yaml` + PORT binding verified locally; README deploy steps documented |
| API-route tests | ✅ | Regions, facilities, scenarios, ask — success + 400s + 500s + parameterization checked |
| Demo polish | ✅ | National KPI overlay (real gaps / data-poor / facilities / strong-evidence) per capability |
| **Track 3: Referral Copilot** | 🚧 | All layers built + hardened: conversation memory, synonym expansion (40-term map), radius escalation (50→100→200km), scope boundaries in system prompt, failure mode handling, 90s timeout, capability search explanations. MAYA-SPEC.md expanded (146→314 lines). 103 tests pass. |

---

## Architectural Decisions

| Decision | Rationale |
|---|---|
| Next.js as unified frontend + backend | Single deployment target for Databricks Apps Free Edition; no separate server |
| gap_score = need × scarcity (formula, not ML) | Transparent, inspectable, citable; hackathon judging rewards clarity |
| `data_poor` flag (not zero gap) | Sparse-evidence regions must not masquerade as "no gap"; honesty is the core design constraint |
| Trust signal: strong / partial / weak / none | Weighs facility supply by evidence quality rather than raw count |
| PIN directory join for districts | Facility `address_stateOrRegion` is too dirty; PIN gives clean state+district for 95% of facilities |
| Diacritic normalization in state join | geoBoundaries ADM1 names diverge from facility data (accents, spelling) — normalize both sides |
| Lakebase for OLTP | Short-lived DB credentials minted from Databricks token; auto-refresh cached; TLS enforced |
| Genie rate limit mitigation | Pre-canned answers + caching; never call Genie in a loop on Free Edition (~5 q/min cap) |
| MapLibre GL + free CARTO basemap | No Mapbox token required; geoBoundaries is open-license |
| Mosaic AI Agent Framework (not Agent Bricks) | Agent Bricks is unavailable on Free Edition |
| Track 3 as separate `/referral` route (not embedded tab) | Independent page with own layout; keeps Track 2 untouched; shared root layout adds minimal nav |
| Mosaic AI Model Serving for Maya (referral agent) | Tool-calling LLM enables arbitrary care-need queries beyond the 6 fixed capabilities; same Databricks token |
| Two-path facility search (capability vs keyword) | Known capabilities use pre-computed `facility_capability` trust; arbitrary needs compute trust dynamically from `facility_base` text fields — same tiered logic as ingestion |
| Rank by trust then distance (not distance-first) | A strong-evidence facility 30km away is a better referral than a weak one 5km away |
| Synonym expansion as backend responsibility (not LLM) | LLM cannot reliably expand synonyms; backend iterates a 40-term bidirectional map when < 3 results, transparently |
| Radius escalation as backend responsibility (not LLM) | LLM picks a radius once; backend auto-widens 50→100→200 km when < 3 results, both search paths |
| Conversation memory via client-side history | Frontend sends last 20 messages with each POST; backend forwards to Mosaic AI; no server-side persistence needed |
| 90s deadline + 60s per-call abort on Mosaic AI | Prevents hung requests; maps timeout errors to user-friendly messages |

---

## Lessons Learned

1. **State field is unusable raw.** `address_stateOrRegion` in the facility dataset mixes city names, district names, freeform text, and abbreviations. Never group by this field directly. Use the PIN directory join to get clean state+district.

2. **Diacritic normalization is non-negotiable for geo joins.** `Odisha` vs `Orissa`, accented characters, trailing spaces — without normalization the choropleth has silent holes (states with data show as data-poor).

3. **`data_poor` flag changes the entire story.** Without it the map implies "no red = no problem." With it, planners see "data-poor = we don't know." This is the core product insight.

4. **Warehouse cold start kills first-load UX.** A 2X-Small warehouse can take 10–30 s to resume from idle. Pre-warm before any demo. Don't put a warehouse round-trip on a latency-critical user path; use Lakebase for that.

5. **Statement Execution API may page results.** Never assume a single response contains all rows. The client in `databricks.ts` must handle the `SUCCEEDED` + `nextChunkIndex` polling loop.

6. **Lakebase credentials expire.** The DB credential from the Databricks token is short-lived (~1 h). Cache it with an expiry timestamp and refresh before use — don't create a new credential on every request.

7. **Parameterization prevents both injection and subtle bugs.** Beyond security, parameterized queries catch capability string typos at bind time rather than returning wrong data silently.

8. **Trust-weighted supply is more honest than raw facility count.** A region with 50 facilities that only mention a capability in passing is weaker evidence than a region with 10 facilities that have structured specialty codes. `strong=1.0, partial=0.6, weak=0.2`.

9. **PIN directory join leaves ~5% unmatched.** ~500 facilities have no PIN match and fall out of district-level views. Document this clearly; don't silently drop rows without a count.

10. **Genie should be optional, not required.** If `DATABRICKS_GENIE_SPACE_ID` is unset the agent must fall back gracefully to formula-based answers. Never hard-depend on Genie for a path that must always work.

11. **MapLibre GL ref must survive React re-renders.** Store the map instance in a `useRef`, not `useState`. Initializing a new map on every render causes a memory leak and flicker.

12. **Vitest needs `@/` alias configured.** Without `resolve.alias` in `vitest.config.ts`, TypeScript path aliases in imports break test runs silently (no module found, not a type error).

13. **Synonym expansion and radius escalation must be backend logic, not LLM instructions.** Telling the LLM "try synonyms" or "widen the radius" via the system prompt is unreliable — the LLM may or may not do it. Making it a backend loop that automatically retries guarantees consistent behavior regardless of LLM variability.

14. **Conversation memory is essential for incomplete-input handling.** A stateless backend (system prompt + single user message) cannot support multi-turn clarification flows ("I need dialysis" → "Which city?" → "Jaipur"). The frontend must send message history with each request.

15. **Never leak raw error messages to users.** Mosaic AI errors include status codes and internal details. Map every error to a user-friendly sentence with a next step. Tool execution errors should be caught individually so one failing tool doesn't crash the whole request.

---

## Things NOT To Do

- **Do NOT string-concat user input into SQL.** Ever. Use parameterized statements on the SQL Statement Execution API. Genie NL inputs are also hostile until validated.
- **Do NOT group facilities by `address_stateOrRegion` directly.** It is dirty. Use the PIN join.
- **Do NOT call Genie in a loop or on every page load.** Rate limit is ~5 q/min on Free Edition. Pre-compute or cache.
- **Do NOT put a SQL warehouse call on a latency-critical path.** Cold start is 10–30 s. Pre-warm for demos; use Lakebase for fast reads.
- **Do NOT assume Statement Execution returns everything in one response.** Always handle chunked/paged results.
- **Do NOT create a new Lakebase credential on every request.** Cache it; refresh lazily before expiry.
- **Do NOT depend on Agent Bricks.** It is not available on Databricks Free Edition.
- **Do NOT show a data-poor region as "no gap."** Always render the `data_poor` flag distinctly.
- **Do NOT `SELECT *` in application code.** Select only the columns the route needs.
- **Do NOT put `DATABRICKS_TOKEN` client-side.** It must never leave the Next.js API routes.
- **Do NOT skip trust-weighting and use raw facility counts.** Raw counts overstate supply.
- **Do NOT add features/abstractions that weren't asked for.** See CLAUDE.md §Behavioral Discipline.
- **Do NOT touch adjacent code while fixing a targeted bug.** Surgical changes only.
- **Do NOT declare a feature done without running tests.** Evidence before assertions, always.

---

## Known Limitations & Open Risks

| Item | Detail | Mitigation |
|---|---|---|
| ~5% facilities unmapped at district level | PIN directory covers 9,563/10,088 facilities | Document in UI; show count; not a blocking issue |
| Facility state field dirty | Used only for state-level fallback; district via PIN is the right path | MD2b complete; don't revert |
| Genie rate limit | ~5 q/min on Free Edition | Pre-canned answers cached; Genie is optional |
| Warehouse cold start | 10–30 s on 2X-Small | Pre-warm before demos; Lakebase for hot paths |
| NFHS-5 data completeness | Some districts missing burden indicators → `data_poor` | Flag shown honestly; not hidden |
| Facility data is claims, not census | Trust signals communicate this; scores are estimates | Core design principle — honesty over false precision |

---

## Changelog

| Date | Entry |
|---|---|
| 2026-06-16 | **Track 3 Maya hardening + features** — Expanded MAYA-SPEC.md (146→361 lines). Implemented: (A) conversation memory (frontend sends 20-msg history); (B) synonym expansion (40-term map, auto-retry < 3 results); (C) radius escalation (50→100→200 km both paths); (D) scope boundaries in system prompt; (E) failure mode handling (per-tool try/catch, user-friendly errors); (F) 90s deadline + 60s per-call AbortSignal. Fixed 3 spec gaps: capability search explanations, distance labels, tool selection preference. Added follow-up questions about returned facilities (system prompt + conversation memory). Added Google Maps directions link in side panel (multicolor Maps pin SVG, opens `maps/dir/?api=1` in new tab). 103 tests pass; production build clean. |
| 2026-06-16 | **Track 3 polish** — Fixed SQL HAVING→subquery for Databricks compat; fixed citation extraction (regexp_extract for keyword-relevant sentence instead of first 500 chars); added `computeExplanation` (explains WHY trust tier was assigned); added `computeMissingEvidence` (flags absent fields); renamed "evidence"→"match" labels; redesigned Maya landing (centered hero + typewriter placeholder + paperclip/arrow chatbox); removed meta obs strip from replies; forced backend to always use tool-execution candidates. |
| 2026-06-16 | **Track 3 Task 2** — `/referral` page, Maya chat/results UI, slide-in facility map panel, shortlist save action, and root nav added. 103 tests pass; production build clean. |
| 2026-06-16 | **Track 3 Task 1** — Maya backend routes added: `/api/referral` tool-calling Mosaic AI flow with parameterized Databricks SQL, `/api/shortlist` Lakebase persistence, shortlist schema helpers, and route tests. 103 tests pass; production build clean. |
| 2026-06-16 | **Track 3 foundation** — `src/lib/referral.ts` (Haversine, ranking, shortlist validation, types) + 29 tests. 87 tests total. Codex agent specs written (`TRACK3-CODEX-SPECS.md`) for parallel API/UI/test tasks. |
| 2026-06-15 | **MD14** Ask UI polish: pill input, animated reasoning card, suggestion chips. 58 tests pass. |
| 2026-06-15 | **MD13** Map↔evidence link: clicking facility point highlights evidence card with pulse animation + trust legend. |
| 2026-06-15 | **MD12** Shareable scenario brief: cited Markdown per scenario, one-click copy. `brief.ts` (6 tests). |
| 2026-06-15 | **MD11** Facility points on map: per-state lat/lon points colored by trust, hover citations, zoom to fit. |
| 2026-06-15 | **MD10** API-route tests added: 51 tests total (was 35). Regions, facilities, scenarios, ask — full coverage. |
| 2026-06-15 | **MD9** Demo polish: national KPI overlay (real gaps / data-poor / facilities / strong-evidence) per capability. |
| 2026-06-15 | **MD2b** District granularity: PIN join → `district_coverage` + `district_gap`; `/api/districts`. Bihar ICU verified. |
| 2026-06-15 | **MD8** Human-in-the-loop trust overrides: `facility_override` in Lakebase; `/api/overrides` GET/POST/DELETE. |
| 2026-06-15 | **MD7** Databricks App readiness: `app.yaml`, PORT binding, README deploy steps. |
| 2026-06-15 | **MD6** Planner agent: `/api/ask` with 4 intents, chain-of-thought UI, drives app state. 10 agent tests. |
| 2026-06-15 | **MD5b** Transparency + observability: `explainGap` chain-of-thought, API meta strips. |
| 2026-06-15 | **MD5** Lakebase scenarios: `/api/scenarios` GET/POST/DELETE, short-lived credential refresh, injection-safe. |
| 2026-06-15 | **MD4** Evidence drill-in: facility records with trust badges + citations per state×capability. |
| 2026-06-15 | **MD3** Gap map: India state choropleth, capability tabs, ranked gaps list, selected-state panel. |
| 2026-06-15 | **MD2** Regional gap model: `region_gap` view, `data_poor` flag, `/api/regions`. Top gaps verified. |
| 2026-06-15 | **MD1** Data foundation: `ingest_facilities.py` → `facility_base` + `facility_capability`. Trust distributions verified. |
| 2026-06-15 | **CLAUDE.md updated** with Karpathy behavioral principles (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) and STATUS.md reference. |
