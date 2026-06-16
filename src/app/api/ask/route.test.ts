import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/databricks", () => ({ runSql: vi.fn() }));
vi.mock("@/lib/genie", () => ({ askGenie: vi.fn() }));
import { runSql } from "@/lib/databricks";
import { askGenie } from "@/lib/genie";
import { POST } from "./route";

const mockRun = vi.mocked(runSql);
const mockGenie = vi.mocked(askGenie);
const mkReq = (body: unknown) => new Request("http://x/api/ask", { method: "POST", body: JSON.stringify(body) });

const region = (state: string, gap: number, dataPoor = false) => ({
  state, n_facilities: 20, gap_score: gap, data_poor: dataPoor,
});

const genie = (text: string, query: { columns: string[]; rows: Record<string, unknown>[] } | null = null) => ({
  text, conversationId: "c1", messageId: "m1",
  query: query ? { sql: "SELECT ...", description: "d", ...query } : null,
});

beforeEach(() => {
  mockRun.mockReset();
  mockGenie.mockReset();
});

describe("POST /api/ask", () => {
  it("requires a question (400)", async () => {
    const res = await POST(mkReq({ question: "   " }));
    expect(res.status).toBe(400);
    expect(mockGenie).not.toHaveBeenCalled();
  });

  it("returns Genie's answer + a chart when Genie ran a chartable query", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Meghalaya", 0.37), region("Bihar", 0.19)] });
    mockGenie.mockResolvedValue(
      genie("Meghalaya has the worst ICU gap.", {
        columns: ["state", "gap"],
        rows: [{ state: "Meghalaya", gap: 0.37 }, { state: "Bihar", gap: 0.19 }],
      })
    );
    const res = await POST(mkReq({ question: "worst ICU gaps in India?" }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.parsed).toMatchObject({ intent: "top_gaps", capability: "icu" });
    expect(j.answer).toBe("Meghalaya has the worst ICU gap.");
    expect(j.focusState).toBe("Meghalaya");
    expect(j.chart).toMatchObject({ type: "bar", xKey: "state", series: ["gap"] });
    expect(j.conversationId).toBe("c1");
    expect(j.steps.length).toBeGreaterThan(1);
  });

  it("returns chart=null when Genie answered with text only", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Bihar", 0.19)] });
    mockGenie.mockResolvedValue(genie("An ICU is an intensive care unit.", null));
    const res = await POST(mkReq({ question: "what is an ICU?" }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.chart).toBeNull();
    expect(j.answer).toMatch(/intensive care/);
  });

  it("focuses the higher-gap region on a compare and attaches its citations", async () => {
    mockRun
      .mockResolvedValueOnce({ columns: [], rows: [region("Bihar", 0.3), region("Kerala", 0.05)] }) // region_gap
      .mockResolvedValueOnce({ columns: [], rows: [{ name: "H", trust: "strong", citation: "ICU beds" }] }); // citations
    mockGenie.mockResolvedValue(genie("Bihar has the larger gap."));
    const res = await POST(mkReq({ question: "compare ICU in Bihar and Kerala" }));
    const j = await res.json();
    expect(j.parsed.intent).toBe("compare");
    expect(j.focusState).toBe("Bihar");
    expect(j.citations[0].citation).toBe("ICU beds");
  });

  it("resolves a state question and pulls that state's citations", async () => {
    mockRun
      .mockResolvedValueOnce({ columns: [], rows: [region("Bihar", 0.19)] }) // region_gap
      .mockResolvedValueOnce({ columns: [], rows: [{ name: "H1", trust: "strong", citation: "Has ICU" }] }); // citations
    mockGenie.mockResolvedValue(genie("Bihar shows an ICU gap."));
    const res = await POST(mkReq({ question: "ICU gaps in Bihar" }));
    const j = await res.json();
    expect(j.parsed.state).toBe("Bihar");
    expect(j.citations[0].citation).toBe("Has ICU");
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("continues an existing Genie conversation when conversationId is supplied", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Bihar", 0.19)] });
    mockGenie.mockResolvedValue(genie("Follow-up answer."));
    await POST(mkReq({ question: "and maternity there?", conversationId: "conv-123" }));
    expect(mockGenie).toHaveBeenCalledWith("and maternity there?", "conv-123");
  });

  it("starts a fresh conversation when no conversationId is given", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Bihar", 0.19)] });
    mockGenie.mockResolvedValue(genie("Fresh answer."));
    await POST(mkReq({ question: "worst ICU gaps?" }));
    expect(mockGenie).toHaveBeenCalledWith("worst ICU gaps?", undefined);
  });

  it("fails closed (500) when Genie errors", async () => {
    mockRun.mockResolvedValue({ columns: [], rows: [region("Bihar", 0.19)] });
    mockGenie.mockRejectedValue(new Error("Genie API 500: boom"));
    const res = await POST(mkReq({ question: "worst ICU gaps?" }));
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.ok).toBe(false);
  });
});
