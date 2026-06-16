---
name: meddesert-feature-workflow
description: "End-to-end guide for adding a new feature to the Medical Desert Planner: the correct sequence (pure lib → route → tests → UI), file locations, import rules, naming conventions, and the definition of done. Use before starting any new feature or non-trivial change."
---

# Medical Desert Planner — Feature Workflow

## The Stack in One View

```
[ src/lib/*.ts ]      Pure logic — no DOM, no DB. Testable in isolation.
      ↓
[ src/app/api/*/route.ts ]  Next.js API routes — call lib + DB. Server-only.
      ↓
[ src/components/*.tsx ]    React UI — calls routes via fetch(). Never calls DB directly.
      ↓
[ scripts/ingest_facilities.py ]  One-time ETL — builds gold tables. Runs in Databricks.
```

---

## Correct Build Order (mandatory)

1. **Pure lib module** — write the validation/calculation/transform logic in `src/lib/`.
2. **Lib tests** — test it in isolation (`src/lib/<module>.test.ts`).
3. **API route** — write `src/app/api/<name>/route.ts` that calls the lib + DB layer.
4. **Route tests** — mock `@/lib/databricks` and/or `@/lib/lakebase`; test all paths.
5. **UI component** — call the route via `fetch()` from a React component.
6. Run `npm test` — all 58+ tests must pass. **This is the definition of done.**

---

## Pure Library Modules (`src/lib/`)

Each module is pure (no DOM, no DB imports). If it touches a DB, it belongs in a route.

| File | What it does | Key exports |
|---|---|---|
| `meddesert.ts` | CAPABILITIES enum, state normalization, trust/gap color helpers | `CAPABILITIES`, `CapabilityKey`, `normalizeState`, `trustLabel`, `trustClass`, `trustColor`, `gapColor` |
| `agent.ts` | NL question parsing → intent + capability + state | `parseQuestion`, `detectCapability`, `detectState`, `planSteps`, `ParsedQuestion`, `Intent` |
| `reasoning.ts` | Gap score chain-of-thought (mirrors ingest formula exactly) | `explainGap`, `GapInputs`, `GapExplanation`, `ReasonStep` |
| `scenario.ts` | Validate + sanitize a POST body into a `CleanScenario` | `validateScenario`, `buildEvidenceSnapshot`, `CleanScenario`, `EvidenceItem` |
| `override.ts` | Validate a trust override POST body into a `CleanOverride` | `validateOverride`, `CleanOverride` |
| `brief.ts` | Render a scenario as shareable Markdown | `scenarioBrief`, `BriefScenario` |
| `databricks.ts` | SQL Statement Execution API client | `runSql`, `SqlParam`, `QueryResult` |
| `lakebase.ts` | Postgres OLTP client (scenarios + overrides) | `saveScenario`, `listScenarios`, `deleteScenario`, `saveOverride`, `listOverrides`, `deleteOverride` |

### Adding a new lib module

```typescript
// src/lib/mymodule.ts
// Pure logic — no DB / DOM → testable.

export function myHelper(input: string): string {
  // validate/transform
  return input.trim();
}
```

```typescript
// src/lib/mymodule.test.ts
import { describe, it, expect } from "vitest";
import { myHelper } from "./mymodule";

describe("myHelper", () => {
  it("trims whitespace", () => expect(myHelper("  x  ")).toBe("x"));
  it("handles empty", () => expect(myHelper("")).toBe(""));
});
```

---

## Databricks Client (`src/lib/databricks.ts`)

**Server-only.** Never import in a component or any file that might reach the browser.

```typescript
import { runSql } from "@/lib/databricks";

// Always parameterize — never string-concat user input into SQL.
const { rows } = await runSql(
  `SELECT name, trust FROM workspace.meddesert.facility_capability
   WHERE capability = :cap AND trust <> 'none' LIMIT 20`,
  [{ name: "cap", value: capability, type: "STRING" }]
);
// rows is Record<string, unknown>[] — all values are strings or nulls from Databricks JSON_ARRAY.
// Cast explicitly: String(r.name ?? ""), Number(r.gap_score ?? 0), r.data_poor === "true"
```

`runSql` polls until terminal (handles warehouse cold-start), 90 s deadline.
See `data-model` skill for canonical query patterns.

---

## Lakebase Client (`src/lib/lakebase.ts`)

**Server-only.** Pool is singleton per process; credentials auto-refresh.
Schema (`saved_scenario`, `facility_override`) is auto-created on first use.

```typescript
import { saveScenario, listScenarios, deleteScenario } from "@/lib/lakebase";
import { saveOverride, listOverrides, deleteOverride } from "@/lib/lakebase";
```

All functions are async and throw on error — wrap in try/catch in routes.

---

## API Routes (`src/app/api/`)

```typescript
// src/app/api/myfeature/route.ts
import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks"; // or lakebase, depending on feature

export const dynamic = "force-dynamic"; // required on every route

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"] as const;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    // 1. Parse + validate params
    const capRaw = (url.searchParams.get("capability") ?? "icu").toLowerCase();
    const capability = (CAPS as readonly string[]).includes(capRaw) ? capRaw : "icu";
    const state = (url.searchParams.get("state") ?? "").trim();
    if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });

    // 2. Query DB (parameterized)
    const t0 = Date.now();
    const { rows } = await runSql(`SELECT ... WHERE capability = :cap AND ...`, [
      { name: "cap", value: capability, type: "STRING" },
    ]);

    // 3. Map rows to response shape (cast all values — Databricks returns strings)
    const items = rows.map((r) => ({
      name: String(r.name ?? ""),
      score: Number(r.score ?? 0),
      flag: r.flag === true || r.flag === "true",
    }));

    // 4. Return success with meta
    return NextResponse.json({
      ok: true,
      capability,
      state,
      count: items.length,
      items,
      meta: { ms: Date.now() - t0, rows: items.length, source: "workspace.meddesert.my_view", engine: "Databricks SQL" },
    });
  } catch (e) {
    // 5. Fail closed — never expose internal details
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
```

---

## UI Components (`src/components/`)

All UI state lives in `MedDesertPlanner.tsx`. Smaller components (`GapMap.tsx`, `AgentAsk.tsx`) receive props.

```typescript
// Fetch pattern used throughout — always handle loading and error states
const [data, setData] = useState<MyType[] | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

async function loadMyFeature(cap: string, state: string) {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(`/api/myfeature?capability=${cap}&state=${encodeURIComponent(state)}`);
    const j = await res.json();
    if (!j.ok) throw new Error(j.error ?? "request failed");
    setData(j.items);
  } catch (e) {
    setError(e instanceof Error ? e.message : "unknown error");
  } finally {
    setLoading(false);
  }
}
```

**CSS conventions (hand-built design system in `globals.css`):**
- Use existing CSS variables for colors, spacing, trust badges (`trust--strong`, etc.).
- Trust badge class: `trustClass(trust)` from `@/lib/meddesert`.
- Don't add new external CSS dependencies — the design system is already defined.

---

## Env Variables

| Var | Used by | Required |
|---|---|---|
| `DATABRICKS_HOST` | `databricks.ts` | yes |
| `DATABRICKS_TOKEN` | `databricks.ts` | yes |
| `DATABRICKS_WAREHOUSE_ID` | `databricks.ts` | yes |
| `DATABRICKS_GENIE_SPACE_ID` | agent route (optional Genie mode) | no |
| `LAKEBASE_INSTANCE` | `lakebase.ts` | yes (if using Lakebase) |
| `LAKEBASE_HOST` | `lakebase.ts` | yes (if using Lakebase) |
| `LAKEBASE_USER` | `lakebase.ts` | yes (if using Lakebase) |
| `LAKEBASE_DATABASE` | `lakebase.ts` | no (defaults `databricks_postgres`) |

All loaded from `.env.local` (never committed). **Never read env vars in client components.**

---

## Definition of Done

A feature is done when ALL of the following are true:

- [ ] Pure lib logic has exhaustive tests (happy path, boundaries, all branches).
- [ ] API route has tests: success 200/201, 400 on bad params, 500 on DB failure, parameterization verified.
- [ ] `npm test` passes (all 58+ tests green).
- [ ] The route follows conventions: `force-dynamic`, 400 before DB call, `meta` object, fail-closed 500.
- [ ] No `SELECT *` in the new query.
- [ ] No secrets or tokens in code.
- [ ] `STATUS.md` updated if this is a milestone-level change.

---

## Common Mistakes

- **Importing `@/lib/databricks` or `@/lib/lakebase` in a component** — these are server-only.
- **String-concatenating user input into SQL** — always use `:name` params with `runSql`.
- **Not casting Databricks row values** — everything comes back as `string | null`; cast explicitly.
- **Forgetting `export const dynamic = "force-dynamic"`** — Next.js will cache GET routes otherwise.
- **Adding validation logic inside the route** — validation belongs in a pure lib module (`validateScenario`, `validateOverride` pattern) so it can be tested without spinning up a route.
- **Skipping the `meta` object** — every Databricks-querying route must return `{ ms, rows, source, engine }`.
