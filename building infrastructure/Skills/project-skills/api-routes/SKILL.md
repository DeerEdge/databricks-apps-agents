---
name: meddesert-api-routes
description: "Complete reference for all Medical Desert Planner API routes: paths, methods, query params, request bodies, response shapes, error codes, and conventions. Use before adding, modifying, or calling any backend endpoint."
---

# Medical Desert Planner — API Routes Reference

## Conventions

- All routes live under `src/app/api/*/route.ts` (Next.js App Router).
- Every file must export `export const dynamic = "force-dynamic"` — no caching at the edge.
- Success responses: `{ ok: true, ...data }` (200 or 201).
- Validation errors: `{ ok: false, error: "<message>" }` (400).
- Server/Databricks errors: `{ ok: false, error: "<message>" }` (500).
- Databricks-querying routes include a `meta` object: `{ ms, rows, source, engine }`.
- **Never import `@/lib/databricks` or `@/lib/lakebase` in client components.** Server-only.
- Capability params default to `"icu"` when missing or invalid (never return 400 on cap).
- `state` is always required where applicable — return 400 if missing.

---

## Route Index

| Method | Path | Databricks | Lakebase | Auth required |
|---|---|---|---|---|
| GET | `/api/health` | ✓ | | no |
| GET | `/api/regions` | ✓ | | no |
| GET | `/api/facilities` | ✓ | | no |
| GET | `/api/districts` | ✓ | | no |
| POST | `/api/ask` | ✓ | | no |
| GET/POST/DELETE | `/api/scenarios` | | ✓ | no |
| GET/POST/DELETE | `/api/overrides` | | ✓ | no |

---

## GET `/api/health`

Smoke test: proves Databricks round-trip is working.

**Response 200:**
```json
{ "ok": true, "databricks": "reachable", "today": "2026-06-15" }
```

---

## GET `/api/regions?capability=<cap>`

State-level gap map data. Returns all states for a capability, ordered real-gaps first.

**Params:** `capability` — one of 6 keys, default `icu`.

**Response 200:**
```json
{
  "ok": true,
  "capability": "icu",
  "count": 32,
  "regions": [{
    "state": "Bihar",
    "nFacilities": 120,
    "strong": 8, "partial": 12, "weak": 40,
    "supply": 22.0,
    "institutionalBirth": 71.9,  // null if no NFHS data
    "insurancePct": 18.2,        // null if no NFHS data
    "needIndex": 0.281,
    "scarcity": 0.854,
    "gapScore": 0.240,
    "dataPoor": false
  }],
  "meta": { "ms": 1240, "rows": 32, "source": "workspace.meddesert.region_gap", "engine": "Databricks SQL" }
}
```

---

## GET `/api/facilities?capability=<cap>&state=<state>`

Facility evidence for a state×capability — the drill-in records behind a gap score.

**Params:** `capability` (default icu), `state` (required — 400 if missing).

**Response 200:**
```json
{
  "ok": true,
  "capability": "icu",
  "state": "Bihar",
  "count": 42,
  "facilities": [{
    "name": "AIIMS Patna",
    "city": "Patna",
    "trust": "strong",
    "citation": "ICU with 24 beds, critical care medicine department",
    "structured": true,
    "claim": true,
    "lat": 25.612,
    "lon": 85.143
  }],
  "meta": { ... }
}
```

Max 60 facilities returned, ordered strong→partial→weak, then by citation length DESC.

---

## GET `/api/districts?capability=<cap>&state=<state>`

District-level gap breakdown within a state (PIN directory join, ~95% facility coverage).

**Params:** `capability` (default icu), `state` (required — 400 if missing).

**Response 200:**
```json
{
  "ok": true,
  "capability": "icu",
  "state": "Bihar",
  "count": 31,
  "districts": [{
    "district": "Purnia",
    "nFacilities": 5,
    "strong": 0,
    "supply": 1.0,
    "institutionalBirth": 68.9,  // null if no NFHS data
    "needIndex": 0.311,
    "scarcity": 0.980,
    "gapScore": 0.305,
    "dataPoor": false
  }],
  "meta": { ... }
}
```

---

## POST `/api/ask`

Grounded planner agent. Parses an NL question, runs parameterized SQL against `region_gap` + `facility_capability`, returns cited answer + reasoning chain.

**Body:**
```json
{ "question": "Where are ICU gaps in Bihar?" }
```

- `question` is required, trimmed to 500 chars. 400 if empty.

**Response 200:**
```json
{
  "ok": true,
  "question": "Where are ICU gaps in Bihar?",
  "parsed": {
    "intent": "gap_in_state",      // gap_in_state | top_gaps | data_poor | facility_evidence
    "capability": "icu",
    "capabilityLabel": "ICU",
    "state": "Bihar"               // null for national intents
  },
  "steps": ["Interpret question → capability ICU, state Bihar", "..."],
  "answer": "Bihar shows an ICU care gap of 0.24 ...",
  "citations": [{
    "name": "AIIMS Patna",
    "trust": "strong",
    "citation": "..."
  }],
  "focusState": "Bihar",           // null or state name — drives UI selection
  "meta": { ... }
}
```

---

## GET `/api/scenarios`

List all saved planning scenarios (newest first, limit 50).

**Response 200:**
```json
{
  "ok": true,
  "count": 3,
  "scenarios": [{
    "id": "42",
    "createdAt": "2026-06-15T18:00:00.000Z",
    "capability": "icu",
    "state": "Bihar",
    "gapScore": 0.24,         // null allowed
    "dataPoor": false,
    "nFacilities": 120,
    "note": "Priority intervention site",
    "evidence": [{ "name": "...", "trust": "strong", "citation": "..." }]
  }]
}
```

## POST `/api/scenarios`

Persist a planning scenario.

**Body (all fields except `gapScore` required):**
```json
{
  "capability": "icu",       // validated against enum — 400 if invalid
  "state": "Bihar",          // required, max 80 chars
  "gapScore": 0.24,          // optional float 0..1
  "dataPoor": false,
  "nFacilities": 120,
  "note": "...",             // max 1000 chars
  "evidence": [{ "name": "...", "trust": "strong", "citation": "..." }]  // max 5 items
}
```

**Response 201:** `{ "ok": true, "scenario": { ...savedScenario } }`

## DELETE `/api/scenarios?id=<id>`

Remove a scenario by numeric ID. 400 if id is not an integer string. 404 if not found.

**Response:** `{ "ok": true }` (200) or `{ "ok": false }` (404).

---

## GET `/api/overrides?capability=<cap>&state=<state>`

Get the latest planner trust override per facility for a capability×state scope.

**Both params required — 400 if missing.**

**Response 200:**
```json
{
  "ok": true,
  "count": 1,
  "overrides": [{
    "id": "7",
    "createdAt": "2026-06-15T18:00:00.000Z",
    "facilityName": "AIIMS Patna",
    "capability": "icu",
    "state": "Bihar",
    "overrideTrust": "partial",  // strong | partial | weak | none
    "note": "confirmed via phone"
  }]
}
```

## POST `/api/overrides`

Record a planner correction of the AI's trust verdict for a facility×capability.

**Body:**
```json
{
  "facilityName": "AIIMS Patna",  // required, max 200 chars
  "capability": "icu",            // validated — 400 if invalid
  "state": "Bihar",               // required
  "overrideTrust": "partial",     // must be strong | partial | weak | none
  "note": "..."                   // optional, max 500 chars
}
```

**Response 201:** `{ "ok": true, "override": { ...savedOverride } }`

## DELETE `/api/overrides?id=<id>`

Same pattern as DELETE `/api/scenarios`. 400/404 on bad/missing id.

---

## Adding a New Route — Checklist

1. Create `src/app/api/<name>/route.ts`.
2. Add `export const dynamic = "force-dynamic"` as the first export.
3. Validate all params at the top — return `400` before any DB call.
4. Use `runSql` from `@/lib/databricks` for Databricks reads (parameterized only).
5. Use `@/lib/lakebase` functions for Lakebase reads/writes.
6. Wrap DB calls in try/catch; return `{ ok: false, error }` (500) on any error.
7. Include `meta: { ms, rows, source, engine }` for Databricks-querying routes.
8. Add `route.test.ts` in the same directory — see `testing-patterns` skill.
