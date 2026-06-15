import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { POST } from "./route";

const mockRun = vi.mocked(runSql);
const mkReq = (body: unknown) => new Request("http://x/api/ask", { method: "POST", body: JSON.stringify(body) });

const region = (state: string, gap: number, strong = 5) => ({
  state, n_facilities: 20, strong, partial: 2, weak: 1, supply: 6,
  institutional_birth: 70, insurance_pct: 50, need_index: 0.3, scarcity: gap / 0.3, gap_score: gap, data_poor: false,
});

beforeEach(() => mockRun.mockReset());

describe("POST /api/ask", () => {
  it("requires a question (400)", async () => {
    const res = await POST(mkReq({ question: "   " }));
    expect(res.status).toBe(400);
  });

  it("answers top_gaps nationally, ranked, with steps", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Meghalaya", 0.37), region("Bihar", 0.19)] });
    const res = await POST(mkReq({ question: "worst ICU gaps in India?" }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.parsed).toMatchObject({ intent: "top_gaps", capability: "icu" });
    expect(j.answer).toMatch(/Meghalaya/);
    expect(j.focusState).toBe("Meghalaya");
    expect(j.steps.length).toBeGreaterThan(1);
  });

  it("resolves a state question and pulls citations", async () => {
    mockRun
      .mockResolvedValueOnce({ columns: [], rows: [region("Bihar", 0.19)] }) // region_gap
      .mockResolvedValueOnce({ columns: [], rows: [{ name: "H1", trust: "strong", citation: "Has ICU" }] }); // citations
    const res = await POST(mkReq({ question: "ICU gaps in Bihar" }));
    const j = await res.json();
    expect(j.parsed.intent).toBe("gap_in_state");
    expect(j.parsed.state).toBe("Bihar");
    expect(j.citations[0].citation).toBe("Has ICU");
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});
