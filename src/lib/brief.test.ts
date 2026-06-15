import { describe, it, expect } from "vitest";
import { scenarioBrief, type BriefScenario } from "./brief";

const base: BriefScenario = {
  capability: "icu", state: "Bihar", createdAt: "2026-06-15T10:00:00Z",
  gapScore: 0.19, dataPoor: false, nFacilities: 258, note: "fund Purnia first",
  evidence: [{ name: "Woodland Hospital", trust: "strong", citation: "Has 14 ICU beds" }],
};

describe("scenarioBrief", () => {
  it("titles with capability + state and dates it", () => {
    const md = scenarioBrief(base);
    expect(md).toMatch(/# Planning scenario — ICU in Bihar/);
    expect(md).toMatch(/Saved 2026-06-15/);
  });

  it("shows the gap score and cites evidence with trust", () => {
    const md = scenarioBrief(base);
    expect(md).toMatch(/Care-gap score:\*\* 0\.19/);
    expect(md).toMatch(/- \*\*Woodland Hospital\*\* — _strong_: “Has 14 ICU beds”/);
  });

  it("includes the planner note when present", () => {
    expect(scenarioBrief(base)).toMatch(/Planner note:\*\* fund Purnia first/);
  });

  it("communicates data-poor honestly instead of a score", () => {
    const md = scenarioBrief({ ...base, dataPoor: true, gapScore: null });
    expect(md).toMatch(/data-poor region/);
    expect(md).not.toMatch(/Care-gap score/);
  });

  it("handles no captured evidence", () => {
    const md = scenarioBrief({ ...base, evidence: [] });
    expect(md).toMatch(/Cited evidence \(0\)/);
    expect(md).toMatch(/No facility evidence/);
  });

  it("tolerates a bad timestamp", () => {
    expect(scenarioBrief({ ...base, createdAt: "nonsense" })).toMatch(/Saved —/);
  });
});
