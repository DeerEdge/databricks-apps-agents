import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateFacilityAnalysis, generateBatchAnalysis } from "./cerebras";
import type { ReferralCandidate, FieldEvidence } from "./referral";

const mkCandidate = (id: string, trust: "strong" | "partial" | "weak" = "strong"): ReferralCandidate => ({
  facilityId: id,
  name: "Test Hospital",
  city: "Jaipur",
  state: "Rajasthan",
  lat: 26.9,
  lon: 75.8,
  distanceKm: 12.3,
  trust,
  citation: "Has nephrology department",
  matchingEvidence: ["Specialty: Nephrology"],
  missingEvidence: ["No matching equipment mentioned"],
  explanation: "Lists Nephrology as a specialty.",
});

const mkEvidence = (): FieldEvidence => ({
  specialties: "Nephrology, Urology",
  procedures: "Hemodialysis",
  equipment: null,
  description: "Multi-specialty hospital with renal care",
});

describe("generateFacilityAnalysis", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, CEREBRAS_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws when CEREBRAS_API_KEY is not set", async () => {
    delete process.env.CEREBRAS_API_KEY;
    await expect(generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence())).rejects.toThrow("CEREBRAS_API_KEY");
  });

  it("calls Cerebras API and returns analysis", async () => {
    const mockResponse = {
      choices: [{ message: { content: "This facility has strong nephrology evidence." } }],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence());
    expect(result).toBe("This facility has strong nephrology evidence.");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.cerebras.ai/v1/chat/completions");
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.model).toBe("gpt-oss-120b");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toContain("dialysis");
    expect(body.messages[1].content).toContain("Nephrology, Urology");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    await expect(generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence())).rejects.toThrow("429");
  });

  it("falls back to reasoning field when content is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { reasoning: "Strong nephrology department confirmed." } }],
      }),
    } as Response);

    const result = await generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence());
    expect(result).toBe("Strong nephrology department confirmed.");
  });

  it("prefers content over reasoning when both present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Final answer.", reasoning: "Internal reasoning." } }],
      }),
    } as Response);

    const result = await generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence());
    expect(result).toBe("Final answer.");
  });

  it("returns empty string when response has neither content nor reasoning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    } as Response);

    const result = await generateFacilityAnalysis(mkCandidate("1"), "dialysis", mkEvidence());
    expect(result).toBe("");
  });
});

describe("generateBatchAnalysis", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, CEREBRAS_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns empty map when no API key", async () => {
    delete process.env.CEREBRAS_API_KEY;
    const result = await generateBatchAnalysis([mkCandidate("1")], "dialysis", new Map([["1", mkEvidence()]]));
    expect(result.size).toBe(0);
  });

  it("returns empty map for empty candidates", async () => {
    const result = await generateBatchAnalysis([], "dialysis", new Map());
    expect(result.size).toBe(0);
  });

  it("generates analysis for multiple candidates in parallel", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `Analysis ${callCount}` } }],
        }),
      } as Response;
    });

    const candidates = [mkCandidate("a"), mkCandidate("b")];
    const evidenceMap = new Map<string, FieldEvidence>([
      ["a", mkEvidence()],
      ["b", mkEvidence()],
    ]);

    const result = await generateBatchAnalysis(candidates, "dialysis", evidenceMap);
    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
  });

  it("skips candidates without evidence in map", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Analysis" } }],
      }),
    } as Response);

    const candidates = [mkCandidate("a"), mkCandidate("b")];
    const evidenceMap = new Map<string, FieldEvidence>([["a", mkEvidence()]]);

    const result = await generateBatchAnalysis(candidates, "dialysis", evidenceMap);
    expect(result.size).toBe(1);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("handles individual call failures gracefully", async () => {
    let callIdx = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) throw new Error("network error");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Analysis" } }],
        }),
      } as Response;
    });

    const candidates = [mkCandidate("a"), mkCandidate("b")];
    const evidenceMap = new Map<string, FieldEvidence>([
      ["a", mkEvidence()],
      ["b", mkEvidence()],
    ]);

    const result = await generateBatchAnalysis(candidates, "dialysis", evidenceMap);
    expect(result.size).toBe(1);
  });
});
