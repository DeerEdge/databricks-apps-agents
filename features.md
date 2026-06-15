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
- [x] **MD5b — transparency + observability.** `reasoning.ts` `explainGap` (pure, mirrors the
      real `region_gap` formula) renders a numbered chain-of-thought (need → supply → scarcity →
      gap) + a plain-language verdict (real-gap vs data-poor, with the exact reasons). APIs return
      `meta` (rows, latency, source table, engine); UI shows live observability strips on the map
      and evidence panel. 5 reasoning tests. Browser-verified.
- [x] **MD6 — planner agent.** `/api/ask` grounded NL agent: `agent.ts` (pure) parses
      capability + state + intent (gap_in_state / top_gaps / data_poor / facility_evidence) and
      plans tool calls; the route runs parameterized queries over `region_gap` +
      `facility_capability` and composes a cited answer + reasoning steps. `AgentAsk` UI streams
      the steps (chain-of-thought), shows the answer + trust-badged citations, and drives the app
      (sets capability tab + selects the state). 10 agent tests. Browser-verified across 4 intents.
- [x] **MD7 — Databricks App readiness.** `app.yaml` (`npm run start`); `next start` binds
      `0.0.0.0:$PORT` (Databricks injects `PORT`) — verified locally (PORT=8123 → 200). README
      deploy steps + secret handling documented. Remaining: run `databricks apps deploy` on the
      workspace (CLI step) + non-technical polish.
- [x] **MD8 — human-in-the-loop trust overrides.** A planner can correct the AI's trust verdict
      on any facility×capability with a note, persisted to Lakebase (`facility_override`). Overrides
      hydrate on revisit and show alongside the AI assessment (both visible — honest). `override.ts`
      validation (pure, 5 tests); `/api/overrides` GET/POST/DELETE. Browser-verified: hydrate,
      create, undo; 400 on invalid trust. Satisfies the prompt's "persist overrides / review decisions".
- [x] **MD2b — district granularity (full).** Facility SUPPLY mapped to district via PIN postcode
      (`india_post_pincode_directory`: 9,563/10k join) × NFHS-5 district DEMAND → `district_coverage`
      + `district_gap` views (3,330 rows; PIN gives clean state+district, sidestepping the messy
      facility state field). `/api/districts?capability=&state=` returns district real-gap-vs-data-poor;
      drill-in shows gap-ranked districts with supply (Ns·Nf) + need. Verified: Bihar ICU → 8 real /
      23 data-poor, Purnia worst (5 facilities, 0 strong, 68.9% inst-birth, gap 0.31).

- [x] **MD9 — demo polish.** Live national KPI overlay on the map (real gaps / data-poor /
      facilities / strong-evidence counts) that updates per capability — derived from loaded data,
      no extra query. Browser-verified (ICU 24 gaps / 230 data-poor / 10,030 facilities).

- [x] **MD10 — API-route tests.** Added `vitest.config.ts` (`@/` alias) + route tests for
      `/api/regions`, `/api/facilities`, `/api/scenarios` (Lakebase mocked), `/api/ask` — success,
      validation 400s, fail-closed 500s, parameterization, and Lakebase-not-touched-on-bad-input.
      51 tests total (was 35). Satisfies CLAUDE.md "test API routes with the Databricks client mocked".

- [x] **MD11 — facility points on the map.** Selecting a state plots its facilities (lat/lon from
      the dataset) as points colored by trust (green=strong … grey=no-claim); the map zooms to fit,
      and hovering a point shows its name, trust, and cited text. `trustColor` pure + test. Verified:
      Bihar → 60 points, zoom 4.2→7.7, green+amber by trust, hover citation. Reliable geographic
      depth without district-polygon name-matching risk.

- [x] **MD12 — shareable scenario brief.** Each saved scenario expands to a cited Markdown brief
      (title, gap score / data-poor status, facility count, planner note, and the captured evidence
      with trust) + one-click copy. `brief.ts` pure (6 tests). Verified live: brief renders with
      cited evidence and "copied ✓". Makes the persisted plan a deliverable a funder can share.

- [x] **MD13 — map↔evidence link + facility legend.** Clicking a facility point on the map
      highlights and scrolls to its evidence card (pulse animation); an on-map trust legend
      (strong/partial/weak/no-claim) appears once a state is selected. Verified live: clicking the
      "Satyarthi Hospital" point highlighted its card; legend shows all four trust keys. Ties the
      geographic and evidence views into one coherent, premium interaction.

- [x] **MD14 — Ask UI polish.** Redesigned the agent panel: pill-shaped input with an arrow
      send button (spinner while loading), rounded suggestion chips, a "Reasoning" card with
      numbered animated steps, and a tinted grounded-answer card. Cleaner, premium feel. Verified
      live (chip → numbered steps → answer). Build clean, 58 tests pass.

- [x] **MD15 — PIN-code geography.** A PIN search box resolves a 6-digit PIN → district + state
      via the India Post directory (`/api/pin`), then selects that state, opens the district
      breakdown, and highlights+scrolls to the matched district (shown even if data-poor / outside
      top-12). `pin.ts` `normalizePin` pure (5 tests). Verified live: 812001 → Bihar / BHAGALPUR
      highlighted. Completes the state/district/PIN geography trio (63 tests, build clean).

- [x] **MD16 — data-poor explorer.** Segmented toggle in the rankings panel: "Real gaps (N)" ↔
      "Data-poor (N)". The data-poor list shows each region with the reason it can't be ranked
      (no verifiable evidence / too few facilities / no NFHS-5 need data) and frames them as
      data-collection candidates, not "no gap". `dataPoorReason` pure (1 test). Verified live (real:
      Meghalaya top; data-poor: Maharashtra/Delhi "no NFHS-5 need data"). Directly serves the core
      "distinguish REAL gaps from DATA-POOR" requirement. Self-critical: many big states fall in
      data-poor due to the *state-level* NFHS name-join being incomplete — the district-level
      `district_gap` matches NFHS far better; consolidating state need onto the cleaner PIN-derived
      state key is the real fix.

- [x] **MD17 — canonical NFHS state join (data-quality fix).** Root-caused why big states fell
      into "data-poor": NFHS-5 spells states differently (MAHARASTRA, NCT OF DELHI, JAMMU KASHMIR)
      than the facility/PIN names, so the exact-match join dropped them. Added a canonical key
      (alpha-only, strip AND/THE, alias the two irreducible spellings) on both sides of
      `region_gap ⋈ region_burden`. Verified: Maharashtra/Delhi/Tamil Nadu/Karnataka/Telangana/
      W. Bengal/Andhra/J&K now carry real NFHS need and rank as *low* gaps (high institutional-birth
      = low need) instead of false "data-poor". Real states 24→28; top gaps unchanged (Meghalaya,
      Manipur, Jharkhand, Bihar). Live API confirms Maharashtra/Delhi dataPoor=false.

- [x] **MD18 — agent COMPARE intent.** The planner agent now handles "compare ICU in Bihar and
      Kerala" → contrasts need / trust-weighted supply / gap score for both regions, names the
      higher-gap one to prioritize, and cites its evidence. `detectStates` (multi-state, ordered)
      + compare branch in `/api/ask`. Caught & fixed a real substring-match bug (the messy state
      value "Mp" matched inside "co**mp**are", and "Bihar?" failed token match) → switched to
      punctuation-aware token matching. 70 tests pass; verified live across all 5 intents + in the UI.

- [x] **MD19 — cross-capability profile.** Selecting a state shows its gap across ALL six
      capabilities (ordered worst-real-gap first, data-poor last) so a planner sees which clinical
      service is most lacking *there*; clicking a row switches the active capability. `/api/state-
      capabilities` (one query) + `orderCapabilityProfile` pure (2 tests). Verified live: Bihar →
      oncology 0.19 top, click Maternity → tab switches. 72 tests, build clean.

- [x] **MD20 — empty-state onboarding.** Before any region is selected, the rail shows a guide
      card: the 4-step workflow (pick capability → choose place → inspect cited evidence → save),
      a trust-signal legend (strong/partial/weak/none with what each means), and the honesty note
      (transparent need×scarcity formula, data-poor never assumed "no gap", data sources). Doubles
      as judge-facing methodology; clears once a state is selected. Verified live (shows → select →
      hides). 72 tests, build clean.

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
