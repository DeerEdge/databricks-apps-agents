import { describe, it, expect } from "vitest";
import { validateScenario, buildEvidenceSnapshot } from "./scenario";

describe("validateScenario", () => {
  it("accepts a well-formed scenario and clamps gap score", () => {
    const r = validateScenario({ capability: "ICU", state: "Bihar", gapScore: 1.4, dataPoor: false, nFacilities: 12, note: "fund here" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capability).toBe("icu");
      expect(r.value.gapScore).toBe(1); // clamped to [0,1]
      expect(r.value.nFacilities).toBe(12);
    }
  });

  it("rejects an unknown capability", () => {
    expect(validateScenario({ capability: "dentistry", state: "Bihar" })).toEqual({ ok: false, error: "invalid capability" });
  });

  it("rejects a missing state", () => {
    expect(validateScenario({ capability: "icu", state: "   " })).toEqual({ ok: false, error: "state required" });
  });

  it("rejects a non-numeric gap score", () => {
    expect(validateScenario({ capability: "icu", state: "Bihar", gapScore: "abc" })).toEqual({ ok: false, error: "gapScore must be a number" });
  });

  it("allows a null gap score (data-poor save)", () => {
    const r = validateScenario({ capability: "icu", state: "Nagaland", gapScore: null, dataPoor: true });
    expect(r.ok && r.value.gapScore).toBe(null);
    expect(r.ok && r.value.dataPoor).toBe(true);
  });

  it("truncates an over-long note", () => {
    const r = validateScenario({ capability: "icu", state: "Bihar", note: "x".repeat(5000) });
    expect(r.ok && r.value.note.length).toBe(1000);
  });
});

describe("buildEvidenceSnapshot", () => {
  it("keeps only cited items, top 5, with clamped citations", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ name: `H${i}`, trust: "strong", citation: "c".repeat(600) }));
    const snap = buildEvidenceSnapshot(items);
    expect(snap.length).toBe(5);
    expect(snap[0].citation.length).toBe(500);
  });

  it("drops items without a citation and tolerates junk", () => {
    expect(buildEvidenceSnapshot([{ name: "A", trust: "weak", citation: "" }, { name: "B", trust: "strong", citation: "real" }])).toEqual([
      { name: "B", trust: "strong", citation: "real" },
    ]);
    expect(buildEvidenceSnapshot(null)).toEqual([]);
    expect(buildEvidenceSnapshot("nope")).toEqual([]);
  });
});
