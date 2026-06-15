import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { GET } from "./route";

const mockRun = vi.mocked(runSql);
beforeEach(() => mockRun.mockReset());

describe("GET /api/facilities", () => {
  it("requires a state (400)", async () => {
    const res = await GET(new Request("http://x/api/facilities?capability=icu"));
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("maps facility rows, coerces booleans, parameterizes cap+state", async () => {
    mockRun.mockResolvedValue({
      columns: [],
      rows: [{ name: "Woodland", city: "Shillong", trust: "strong", citation: "Has 14 ICU beds", structured: true, claim: "true" }],
    });
    const res = await GET(new Request("http://x/api/facilities?capability=icu&state=Meghalaya"));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.facilities[0]).toMatchObject({ name: "Woodland", trust: "strong", structured: true, claim: true });
    expect(j.meta.source).toContain("facility_capability");
    const params = mockRun.mock.calls[0][1]!;
    expect(params).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "cap", value: "icu" }),
      expect.objectContaining({ name: "state", value: "Meghalaya" }),
    ]));
  });

  it("defaults an unknown capability to icu", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [] });
    await GET(new Request("http://x/api/facilities?capability=xray&state=Bihar"));
    expect(mockRun.mock.calls[0][1]![0]).toMatchObject({ name: "cap", value: "icu" });
  });

  it("fails closed (500) on an unusable result", async () => {
    // @ts-expect-error malformed shape simulates a backend failure
    mockRun.mockResolvedValue({ columns: [], rows: null });
    const res = await GET(new Request("http://x/api/facilities?capability=icu&state=Bihar"));
    expect(res.status).toBe(500);
  });
});
