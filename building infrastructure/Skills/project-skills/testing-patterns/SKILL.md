---
name: meddesert-testing-patterns
description: "How to write and run tests for the Medical Desert Planner: vitest config, pure-lib test patterns, API route test anatomy with Databricks/Lakebase mocks, and the mandatory test checklist for new features. Use before writing any test file."
---

# Medical Desert Planner — Testing Patterns

## Setup

**Runner:** vitest  
**Config:** `vitest.config.ts` in repo root — sets `environment: "node"` and resolves `@/` → `src/`.

```bash
npm test            # run all tests (vitest)
npm test -- --run   # single pass, no watch
```

**Current count:** 58 tests across 8 files. A feature is NOT done until its tests exist and pass.

---

## File Placement

| What you're testing | Where the test file goes |
|---|---|
| Pure lib module (`meddesert.ts`, `agent.ts`, etc.) | `src/lib/<module>.test.ts` |
| API route | `src/app/api/<route>/route.test.ts` |

---

## Pattern 1 — Pure Library Modules

No mocks needed. Import directly. Test: happy path, boundaries, every branch.

```typescript
// src/lib/meddesert.test.ts pattern
import { describe, it, expect } from "vitest";
import { normalizeState, gapColor, trustClass } from "./meddesert";

describe("normalizeState", () => {
  it("strips diacritics + uppercases", () => {
    expect(normalizeState("Mahārāshtra")).toBe("MAHARASHTRA");
  });
  it("handles empty string", () => {
    expect(normalizeState("")).toBe("");
  });
});

describe("gapColor", () => {
  it("clamps out-of-range input", () => {
    expect(gapColor(-5)).toBe(gapColor(0));
    expect(gapColor(99)).toBe(gapColor(1));
  });
});
```

**Always test:**
- The happy path (normal input)
- Empty / null / zero inputs
- Unknown / invalid input (especially trust keys — they fall back to `weak`)
- Every if/else branch

---

## Pattern 2 — API Routes (Databricks-querying)

Mock `@/lib/databricks` **before** importing the route. The `vi.mock()` hoisting means the mock
declaration must appear before any import that transitively uses it.

```typescript
// src/app/api/regions/route.test.ts pattern
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { GET } from "./route";

const mockRun = vi.mocked(runSql);

// A realistic DB row — use snake_case matching actual column names from the view.
const row = {
  state: "Bihar", n_facilities: 258, strong: 63, partial: 20, weak: 10, supply: 80,
  institutional_birth: 77.8, insurance_pct: 55, need_index: 0.222,
  scarcity: 0.84, gap_score: 0.186, data_poor: false,
};

beforeEach(() => mockRun.mockReset());

describe("GET /api/regions", () => {
  it("maps rows and attaches provenance meta", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [row] });
    const res = await GET(new Request("http://x/api/regions?capability=icu"));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.regions[0]).toMatchObject({ state: "Bihar", gapScore: 0.186, dataPoor: false });
    expect(j.meta.source).toContain("region_gap");
  });

  it("defaults invalid capability to icu and uses it as the param", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [] });
    await GET(new Request("http://x/api/regions?capability=hacking"));
    // Check that the SQL parameter was sanitized
    const params = mockRun.mock.calls[0][1]!;
    expect(params[0]).toMatchObject({ name: "cap", value: "icu" });
  });

  it("returns 500 (fail closed) when Databricks is unavailable", async () => {
    mockRun.mockRejectedValue(new Error("warehouse offline"));
    const res = await GET(new Request("http://x/api/regions?capability=icu"));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it("returns 500 (fail closed) when result shape is malformed", async () => {
    // @ts-expect-error simulates a backend shape error
    mockRun.mockResolvedValue({ columns: [], rows: null });
    const res = await GET(new Request("http://x/api/regions?capability=icu"));
    expect(res.status).toBe(500);
  });
});
```

**Mandatory coverage for every Databricks route:**
1. Happy path — rows mapped correctly, camelCase response fields, `meta.source` present.
2. Bad/missing params — confirm sanitized param value in `mockRun.mock.calls[0][1]`.
3. Missing required param (e.g. `state`) — 400 without calling `runSql`.
4. Databricks throws — 500, `ok: false`.
5. Databricks returns malformed data — 500, `ok: false`.

---

## Pattern 3 — API Routes (Lakebase)

Mock `@/lib/lakebase` instead. Same hoisting rule.

```typescript
// src/app/api/scenarios/route.test.ts pattern
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lakebase", () => ({
  saveScenario: vi.fn(),
  listScenarios: vi.fn(),
  deleteScenario: vi.fn(),
}));
import { saveScenario, listScenarios, deleteScenario } from "@/lib/lakebase";
import { GET, POST, DELETE } from "./route";

const mkReq = (body: unknown) =>
  new Request("http://x/api/scenarios", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(saveScenario).mockReset();
  vi.mocked(listScenarios).mockReset();
  vi.mocked(deleteScenario).mockReset();
});

describe("POST /api/scenarios", () => {
  it("rejects invalid capability (400) without touching Lakebase", async () => {
    const res = await POST(mkReq({ capability: "dentistry", state: "Bihar" }));
    expect(res.status).toBe(400);
    expect(saveScenario).not.toHaveBeenCalled(); // key: validation fires before DB call
  });

  it("persists valid scenario (201) and normalizes values", async () => {
    vi.mocked(saveScenario).mockResolvedValue({
      id: "1", createdAt: "t", capability: "icu", state: "Bihar",
      gapScore: 1, dataPoor: false, nFacilities: 5, note: "", evidence: [],
    });
    const res = await POST(mkReq({ capability: "ICU", state: "Bihar", gapScore: 1.5, nFacilities: 5 }));
    expect(res.status).toBe(201);
    const arg = vi.mocked(saveScenario).mock.calls[0][0];
    expect(arg).toMatchObject({ capability: "icu", gapScore: 1 }); // lowercased + clamped
  });
});

describe("DELETE /api/scenarios", () => {
  it("rejects non-numeric id (400)", async () => {
    const res = await DELETE(new Request("http://x/api/scenarios?id=abc", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(deleteScenario).not.toHaveBeenCalled();
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(deleteScenario).mockResolvedValue(false);
    const res = await DELETE(new Request("http://x/api/scenarios?id=99", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });
});
```

---

## Pattern 4 — Routes Using Both Databricks + Lakebase

Mock both at the top. Example: if a route reads from Databricks then writes to Lakebase.

```typescript
vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
vi.mock("@/lib/lakebase", () => ({ saveScenario: vi.fn(), listScenarios: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { saveScenario } from "@/lib/lakebase";
```

---

## Mandatory Test Checklist (per new route/module)

For **pure library modules:**
- [ ] Happy path returns the correct value
- [ ] Empty / null / zero / boundary inputs don't throw
- [ ] Every branch is exercised
- [ ] Unknown / invalid input falls back gracefully (not silently wrong)

For **API routes:**
- [ ] 200/201 success — response shape is correct, `ok: true`
- [ ] Invalid/missing required params — `400`, `ok: false`, Lakebase/Databricks NOT called
- [ ] Parameterization verified — `mockRun.mock.calls[0][1]` has the right `{ name, value }` pair
- [ ] DB throws → `500`, `ok: false` (fail-closed)
- [ ] DB returns malformed data → `500`, `ok: false`

---

## Common Mistakes

- **Forgetting `vi.mock()` before imports** — vitest hoists mock declarations but only if they appear before the first use. Always put `vi.mock(...)` as the first thing in the file.
- **Using real column names wrong** — mock row objects must use `snake_case` (e.g. `n_facilities`, `gap_score`, `data_poor`) matching what Databricks returns; the route converts these to camelCase.
- **Not calling `mockReset()` in `beforeEach`** — state bleeds between tests, causing false positives.
- **Testing implementation, not behavior** — test what the route returns (status, `ok`, field values), not how it loops internally.
- **Marking a feature done before tests pass** — run `npm test` and show real output.
