import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/databricks", () => ({
  runSql: vi.fn(),
}));
import { runSql } from "@/lib/databricks";
import { POST } from "./route";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

const mkReq = (body: unknown) =>
  new Request("http://x/api/referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(runSql).mockReset();
  mockFetch.mockReset();
  process.env.MOSAIC_AI_ENDPOINT = "https://test.cloud.databricks.com/serving-endpoints/maya/invocations";
  process.env.DATABRICKS_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.MOSAIC_AI_ENDPOINT;
  delete process.env.DATABRICKS_TOKEN;
});

describe("POST /api/referral", () => {
  it("rejects empty question (400)", async () => {
    const res = await POST(mkReq({ question: "" }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toContain("question required");
  });

  it("rejects invalid JSON (400)", async () => {
    const res = await POST(new Request("http://x/api/referral", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when Mosaic AI endpoint is missing", async () => {
    delete process.env.MOSAIC_AI_ENDPOINT;
    const res = await POST(mkReq({ question: "dialysis near Jaipur" }));
    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 500 when Mosaic AI fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service unavailable",
    });
    const res = await POST(mkReq({ question: "dialysis near Jaipur" }));
    expect(res.status).toBe(500);
  });

  it("success: calls Mosaic AI tools and returns structured response", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                id: "tc1",
                function: {
                  name: "get_location_coords",
                  arguments: JSON.stringify({ place_name: "Jaipur" }),
                },
              }],
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                answer: "I found facilities with dialysis near Jaipur.",
                reasoning_steps: ["Resolved Jaipur to coordinates", "Searched for dialysis"],
                resolved_need: "dialysis",
                resolved_location: "Jaipur",
                candidates: [],
              }),
            },
          }],
        }),
      });

    vi.mocked(runSql).mockResolvedValueOnce({
      columns: ["lat", "lon", "n"],
      rows: [{ lat: 26.9, lon: 75.8, n: 42 }],
    });

    const res = await POST(mkReq({ question: "dialysis near Jaipur" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.answer).toContain("dialysis");
    expect(j.reasoningSteps).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not string-concatenate user input into SQL", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                id: "tc1",
                function: {
                  name: "search_facilities_by_keyword",
                  arguments: JSON.stringify({ keyword: "dialysis'; DROP TABLE--", lat: 26.9, lon: 75.8 }),
                },
              }],
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ answer: "no results", reasoning_steps: [], candidates: [] }) } }],
        }),
      });

    vi.mocked(runSql).mockResolvedValue({ columns: [], rows: [] });

    const res = await POST(mkReq({ question: "test" }));
    expect(res.status).toBe(200);

    const call = vi.mocked(runSql).mock.calls[0];
    expect(call[0]).toContain(":kw");
    expect(call[0]).not.toContain("DROP TABLE");
    expect(call[1]).toContainEqual(expect.objectContaining({ name: "kw", value: "%dialysis'; drop table--%" }));
  });
});
