import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { GET } from "./route";

const mockRun = vi.mocked(runSql);
const row = {
  state: "Bihar", n_facilities: 258, strong: 63, partial: 20, weak: 10, supply: 80,
  institutional_birth: 77.8, insurance_pct: 55, need_index: 0.222, scarcity: 0.84, gap_score: 0.186, data_poor: false,
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

  it("defaults an invalid capability to icu and parameterizes the query", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [] });
    await GET(new Request("http://x/api/regions?capability=hacking"));
    const params = mockRun.mock.calls[0][1]!;
    expect(params[0]).toMatchObject({ name: "cap", value: "icu" });
  });

  it("returns 500 (fails closed) when the result is unusable", async () => {
    // @ts-expect-error malformed shape simulates a backend failure
    mockRun.mockResolvedValue({ columns: [], rows: null });
    const res = await GET(new Request("http://x/api/regions?capability=icu"));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });
});
