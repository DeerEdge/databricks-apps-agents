import { describe, it, expect } from "vitest";
import {
  haversineKm,
  rankScore,
  rankCandidates,
  computeRankReasons,
  validateShortlistInput,
  type ReferralCandidate,
} from "./referral";

// ---------- HAVERSINE ----------

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(26.9, 75.8, 26.9, 75.8)).toBe(0);
  });

  it("calculates Delhi→Chennai (~1750 km)", () => {
    const d = haversineKm(28.6139, 77.209, 13.0827, 80.2707);
    expect(d).toBeGreaterThan(1700);
    expect(d).toBeLessThan(1800);
  });

  it("handles short distance (~10 km)", () => {
    const d = haversineKm(26.9124, 75.7873, 26.82, 75.80);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(12);
  });

  it("is symmetric", () => {
    const ab = haversineKm(28.6, 77.2, 19.1, 72.9);
    const ba = haversineKm(19.1, 72.9, 28.6, 77.2);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it("handles equator crossing", () => {
    const d = haversineKm(1, 80, -1, 80);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(230);
  });
});

// ---------- RANKING ----------

describe("rankScore", () => {
  it("strong + close ranks highest", () => {
    expect(rankScore("strong", 5)).toBeGreaterThan(rankScore("partial", 5));
    expect(rankScore("strong", 5)).toBeGreaterThan(rankScore("strong", 50));
  });

  it("strong far beats weak close", () => {
    expect(rankScore("strong", 30)).toBeGreaterThan(rankScore("weak", 5));
  });

  it("distance decay: 50km halves the score", () => {
    const at0 = rankScore("strong", 0);
    const at50 = rankScore("strong", 50);
    expect(at50).toBeCloseTo(at0 / 2, 5);
  });

  it("unknown trust uses fallback weight", () => {
    const s = rankScore("unknown", 10);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(rankScore("weak", 10));
  });

  it("zero distance gives max score for trust tier", () => {
    expect(rankScore("strong", 0)).toBe(1.0);
    expect(rankScore("partial", 0)).toBe(0.6);
    expect(rankScore("weak", 0)).toBe(0.2);
  });
});

describe("rankCandidates", () => {
  const mkCandidate = (trust: string, distanceKm: number): ReferralCandidate => ({
    facilityId: "1",
    name: "Test",
    city: "City",
    state: "State",
    lat: 26,
    lon: 75,
    distanceKm,
    trust: trust as "strong" | "partial" | "weak",
    citation: "",
    matchingEvidence: [],
    missingEvidence: [],
    explanation: "",
  });

  it("sorts best candidates first", () => {
    const candidates = [
      mkCandidate("weak", 5),
      mkCandidate("strong", 20),
      mkCandidate("partial", 10),
    ];
    const sorted = rankCandidates(candidates);
    expect(sorted[0].trust).toBe("strong");
    expect(sorted[1].trust).toBe("partial");
    expect(sorted[2].trust).toBe("weak");
  });

  it("returns a new array (does not mutate)", () => {
    const candidates = [mkCandidate("weak", 5), mkCandidate("strong", 20)];
    const sorted = rankCandidates(candidates);
    expect(sorted).not.toBe(candidates);
    expect(candidates[0].trust).toBe("weak");
  });

  it("handles empty array", () => {
    expect(rankCandidates([])).toEqual([]);
  });

  it("same trust: closer wins", () => {
    const candidates = [
      mkCandidate("strong", 30),
      mkCandidate("strong", 10),
      mkCandidate("strong", 50),
    ];
    const sorted = rankCandidates(candidates);
    expect(sorted[0].distanceKm).toBe(10);
    expect(sorted[1].distanceKm).toBe(30);
    expect(sorted[2].distanceKm).toBe(50);
  });
});

// ---------- RANK REASONS ----------

describe("computeRankReasons", () => {
  const mkCandidate = (trust: string, distanceKm: number, id = "1"): ReferralCandidate => ({
    facilityId: id,
    name: "Test",
    city: "City",
    state: "State",
    lat: 26,
    lon: 75,
    distanceKm,
    trust: trust as "strong" | "partial" | "weak",
    citation: "",
    matchingEvidence: [],
    missingEvidence: [],
    explanation: "",
  });

  it("returns empty array for empty input", () => {
    expect(computeRankReasons([])).toEqual([]);
  });

  it("tags #1 as best match", () => {
    const result = computeRankReasons([mkCandidate("strong", 5, "a")]);
    expect(result[0].rankReason).toContain("#1");
    expect(result[0].rankReason).toContain("best match");
  });

  it("assigns increasing rank numbers", () => {
    const result = computeRankReasons([
      mkCandidate("strong", 5, "a"),
      mkCandidate("partial", 10, "b"),
      mkCandidate("weak", 20, "c"),
    ]);
    expect(result[0].rankReason).toContain("#1");
    expect(result[1].rankReason).toContain("#2");
    expect(result[2].rankReason).toContain("#3");
  });

  it("notes when lower-ranked has same trust but farther", () => {
    const result = computeRankReasons([
      mkCandidate("strong", 5, "a"),
      mkCandidate("strong", 30, "b"),
    ]);
    expect(result[1].rankReason).toContain("farther");
  });

  it("notes when closer but weaker evidence", () => {
    const result = computeRankReasons([
      mkCandidate("strong", 20, "a"),
      mkCandidate("weak", 5, "b"),
    ]);
    expect(result[1].rankReason).toContain("closer");
    expect(result[1].rankReason).toContain("weak");
  });

  it("preserves original candidate data", () => {
    const result = computeRankReasons([mkCandidate("strong", 5, "abc")]);
    expect(result[0].facilityId).toBe("abc");
    expect(result[0].trust).toBe("strong");
    expect(result[0].distanceKm).toBe(5);
  });
});

// ---------- VALIDATION ----------

describe("validateShortlistInput", () => {
  const valid = {
    facilityId: "123",
    name: "Rajasthan Kidney Hospital",
    city: "Jaipur",
    state: "Rajasthan",
    lat: 26.9,
    lon: 75.8,
    distanceKm: 12.3,
    trust: "strong",
    citation: "Has 200-bed dialysis unit with 8 machines",
    queryContext: "dialysis near Jaipur",
    note: "",
  };

  it("accepts valid input", () => {
    const r = validateShortlistInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.facilityId).toBe("123");
      expect(r.value.distanceKm).toBe(12.3);
    }
  });

  it("rejects missing facilityId", () => {
    const r = validateShortlistInput({ ...valid, facilityId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("facilityId");
  });

  it("rejects missing name", () => {
    const r = validateShortlistInput({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("name");
  });

  it("rejects missing state", () => {
    const r = validateShortlistInput({ ...valid, state: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("state");
  });

  it("rejects non-numeric lat", () => {
    const r = validateShortlistInput({ ...valid, lat: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("lat/lon");
  });

  it("rejects NaN lon", () => {
    const r = validateShortlistInput({ ...valid, lon: NaN });
    expect(r.ok).toBe(false);
  });

  it("rejects negative distanceKm", () => {
    const r = validateShortlistInput({ ...valid, distanceKm: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("distanceKm");
  });

  it("rejects invalid trust (none is not valid for shortlist)", () => {
    const r = validateShortlistInput({ ...valid, trust: "none" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("trust");
  });

  it("rejects unknown trust", () => {
    const r = validateShortlistInput({ ...valid, trust: "excellent" });
    expect(r.ok).toBe(false);
  });

  it("clamps long note to 1000 chars", () => {
    const r = validateShortlistInput({ ...valid, note: "x".repeat(2000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note.length).toBeLessThanOrEqual(1000);
  });

  it("clamps long citation to 500 chars", () => {
    const r = validateShortlistInput({ ...valid, citation: "y".repeat(800) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.citation.length).toBeLessThanOrEqual(500);
  });

  it("rounds distanceKm to 1 decimal", () => {
    const r = validateShortlistInput({ ...valid, distanceKm: 12.3456 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.distanceKm).toBe(12.3);
  });

  it("handles null body gracefully", () => {
    const r = validateShortlistInput(null);
    expect(r.ok).toBe(false);
  });

  it("handles undefined body gracefully", () => {
    const r = validateShortlistInput(undefined);
    expect(r.ok).toBe(false);
  });

  it("treats non-string fields as empty strings", () => {
    const r = validateShortlistInput({ ...valid, facilityId: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("facilityId");
  });
});
