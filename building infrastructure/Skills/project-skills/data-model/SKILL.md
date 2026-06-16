---
name: meddesert-data-model
description: "Complete reference for the Medical Desert Planner data layer: gold table schemas, trust model, gap-score formula, data_poor logic, CAPABILITIES enum, and parameterized SQL patterns. Use before writing any query, route, or data-processing logic."
---

# Medical Desert Planner — Data Model Reference

## Source Dataset

`databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset`

| Table | Rows | Key Fields |
|---|---|---|
| `facilities` | ~10,088 | `name`, `address_stateOrRegion`, `address_pinCode`, `latitude`, `longitude`, `specialties`, `capability` (JSON array), `description`, `procedures`, `equipment` |
| `india_post_pincode_directory` | ~155k | `pincode`, `state_name`, `district_name` |
| `nfhs_5_district_health_indicators` | ~700+ | `state`, `district`, `institutional_births_pct`, `health_insurance_pct`, and many others |

**Key caveat:** `address_stateOrRegion` is dirty — mixes city names, abbreviations, freeform text. Use PIN directory join for clean state+district.

---

## Gold Tables/Views — `workspace.meddesert`

### `facility_base` (Delta table)
One row per facility. Cleaned fields from the source.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint | source row id |
| `name` | string | facility name |
| `state` | string | from `address_stateOrRegion` (dirty — see above) |
| `city` | string | |
| `pin_code` | string | |
| `latitude` | double | |
| `longitude` | double | |
| `specialties` | string | raw specialty codes (pipe-separated or JSON) |
| `capability` | string | raw JSON array of capability claims |
| `description` | string | free-text |

### `facility_capability` (Delta table)
One row per facility × capability (6 caps = up to 60k rows). The core evidence table.

| Column | Type | Notes |
|---|---|---|
| `facility_id` | bigint | FK to `facility_base` |
| `name` | string | facility name (denormalized for query convenience) |
| `state` | string | from `facility_base.state` (dirty) |
| `capability` | string | one of the 6 keys — see CAPABILITIES enum below |
| `trust` | string | `strong` / `partial` / `weak` / `none` |
| `citation` | string | the facility's own text backing the claim |

**Only query rows where `trust <> 'none'`** — `none` rows exist but are excluded from supply.

### `region_burden` (View)
NFHS-5 indicators aggregated to state, diacritic-normalized.

| Column | Notes |
|---|---|
| `state` | uppercased, diacritic-stripped (matches `normalizeState()`) |
| `institutional_birth` | % institutional births (drives need_index for maternity/ICU/emergency) |
| `insurance_pct` | % population with health insurance |

### `region_coverage` (View)
Trust-weighted facility supply per state × capability.

| Column | Notes |
|---|---|
| `state` | |
| `capability` | |
| `n_facilities` | total facilities with any non-none trust |
| `strong` / `partial` / `weak` | counts |
| `supply` | `1·strong + 0.5·partial + 0.2·weak` |

### `region_gap` (View) — primary read target for most routes
Gap score + data-poor flag per state × capability.

| Column | Type | Notes |
|---|---|---|
| `state` | string | |
| `capability` | string | |
| `n_facilities` | int | |
| `strong` / `partial` / `weak` | int | |
| `supply` | double | trust-weighted supply |
| `institutional_birth` | double? | null if no NFHS data |
| `insurance_pct` | double? | |
| `need_index` | double | `(100 − institutional_birth) / 100`; defaults 0.5 if no NFHS |
| `scarcity` | double | `1 − supply / max_supply_for_cap`; 0 if only state |
| `gap_score` | double | `need_index × scarcity` — 0..1, higher = worse gap |
| `data_poor` | boolean | see definition below |

### District Views (from PIN join)

`district_coverage` — same shape as `region_coverage` but at district level (via PIN directory).
`district_gap` — same shape as `region_gap` but at district level. ~3,330 rows. 95% facility coverage.

---

## CAPABILITIES Enum

```typescript
// src/lib/meddesert.ts
export const CAPABILITIES = [
  { key: "icu",       label: "ICU" },
  { key: "maternity", label: "Maternity" },
  { key: "emergency", label: "Emergency" },
  { key: "oncology",  label: "Oncology" },
  { key: "trauma",    label: "Trauma" },
  { key: "nicu",      label: "NICU" },
] as const;
export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];
```

Always validate capability params against these 6 keys. Default: `"icu"`.

---

## Trust Model

Facilities are treated as **claims to verify**, not ground truth.

| Trust | Definition | Supply weight |
|---|---|---|
| `strong` | structured specialty code **AND** (claim array OR description text) agree | 1.0 |
| `partial` | structured specialty code **XOR** claim array — one solid source | 0.5 |
| `weak` | free-text description only | 0.2 |
| `none` | no mention — excluded from coverage entirely | 0 |

---

## Gap Score Formula (mirrors `reasoning.ts` + `ingest_facilities.py`)

```
supply     = 1·strong + 0.5·partial + 0.2·weak
need_index = (100 − institutional_birth%) / 100   [0.5 if no NFHS data]
scarcity   = 1 − supply / max(supply across all states for this cap)
gap_score  = need_index × scarcity                [0..1, higher = worse]

data_poor  = (strong + partial == 0)
          OR (n_facilities < 10)
          OR (institutional_birth is NULL)
```

**Critical:** `data_poor` regions are shown differently on the map (grey), never ranked as confirmed gaps. A `data_poor` region means "we don't know," not "no problem."

---

## Lakebase Tables (`workspace` / `databricks_postgres` DB)

### `saved_scenario`
```sql
CREATE TABLE saved_scenario (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  capability   text NOT NULL,         -- capability key
  state        text NOT NULL,
  gap_score    double precision,      -- nullable
  data_poor    boolean NOT NULL DEFAULT false,
  n_facilities integer NOT NULL DEFAULT 0,
  note         text NOT NULL DEFAULT '',
  evidence     jsonb NOT NULL DEFAULT '[]'  -- EvidenceItem[]
);
```

### `facility_override`
```sql
CREATE TABLE facility_override (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  facility_name  text NOT NULL,
  capability     text NOT NULL,
  state          text NOT NULL,
  override_trust text NOT NULL,  -- trust key: strong/partial/weak/none
  note           text NOT NULL DEFAULT ''
);
```

---

## Canonical SQL Patterns

Always use `:name` markers (Statement Execution API) — never string-concat.

```typescript
// Region gap for a capability
`SELECT state, n_facilities, strong, partial, weak, supply,
        institutional_birth, insurance_pct, need_index, scarcity, gap_score, data_poor
 FROM workspace.meddesert.region_gap
 WHERE capability = :cap
 ORDER BY data_poor ASC, gap_score DESC`
// params: [{ name: "cap", value: capability, type: "STRING" }]

// Facility evidence for a state×capability (trust ordering: strong first)
`SELECT name, trust, citation
 FROM workspace.meddesert.facility_capability
 WHERE capability = :cap AND upper(trim(state)) = upper(trim(:state)) AND trust <> 'none'
 ORDER BY CASE trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 WHEN 'weak' THEN 2 ELSE 3 END,
          length(coalesce(citation,'')) DESC
 LIMIT 20`
// params: [{ name: "cap", value: cap }, { name: "state", value: state }]

// Facility points (lat/lon) for map rendering
`SELECT name, latitude, longitude, trust, citation
 FROM workspace.meddesert.facility_capability fc
 JOIN workspace.meddesert.facility_base fb ON fc.facility_id = fb.id
 WHERE fc.capability = :cap AND upper(trim(fc.state)) = upper(trim(:state)) AND fc.trust <> 'none'`

// District gap drill-in
`SELECT district, n_facilities, strong, partial, weak, supply, need_index, gap_score, data_poor
 FROM workspace.meddesert.district_gap
 WHERE capability = :cap AND upper(trim(state)) = upper(trim(:state))
 ORDER BY data_poor ASC, gap_score DESC`
```

---

## State Normalization

Use `normalizeState()` from `src/lib/meddesert.ts` any time you compare state names across datasets:
```typescript
import { normalizeState } from "@/lib/meddesert";
// "Mahārāshtra" → "MAHARASHTRA"
// Strips diacritics, uppercases, trims whitespace
```

The views already apply the same normalization on both sides of the join.
