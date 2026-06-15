import { describe, it, expect } from "vitest";
import { explainGap, type GapInputs } from "./reasoning";

const base: GapInputs = {
  state: "Bihar", nFacilities: 156, strong: 20, partial: 14, weak: 8, supply: 28.6,
  institutionalBirth: 76.2, insurancePct: 55.1, needIndex: 0.238, scarcity: 0.6, gapScore: 0.143, dataPoor: false,
};

describe("explainGap", () => {
  it("produces the four-step derivation in order", () => {
    const e = explainGap(base, "ICU");
    expect(e.steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(e.steps[0].label).toMatch(/NFHS-5 demand/);
    expect(e.steps[1].value).toBe("28.6");
    expect(e.steps[3].formula).toBe("gap = need × scarcity");
  });

  it("flags a real gap with supporting reasons", () => {
    const e = explainGap(base, "ICU");
    expect(e.verdict.kind).toBe("real-gap");
    expect(e.verdict.reasons.some((r) => /strong evidence/.test(r))).toBe(true);
  });

  it("explains data-poor: no verifiable evidence", () => {
    const e = explainGap({ ...base, strong: 0, partial: 0, weak: 1, dataPoor: true }, "ICU");
    expect(e.verdict.kind).toBe("data-poor");
    expect(e.verdict.reasons[0]).toMatch(/No facility carries verifiable ICU evidence/);
  });

  it("explains data-poor: too few facilities", () => {
    const e = explainGap({ ...base, nFacilities: 4, dataPoor: true }, "Trauma");
    expect(e.verdict.reasons.some((r) => /Only 4 facilities/.test(r))).toBe(true);
  });

  it("explains data-poor: missing NFHS need data and defaults need", () => {
    const e = explainGap({ ...base, institutionalBirth: null, insurancePct: null, needIndex: 0.5, dataPoor: true }, "ICU");
    expect(e.steps[0].detail).toMatch(/defaults to 0.5/);
    expect(e.verdict.reasons.some((r) => /No NFHS-5 need data/.test(r))).toBe(true);
  });
});
