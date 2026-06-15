import { describe, it, expect } from "vitest";
import { normalizeState, gapColor, trustLabel, trustClass, trustColor, orderCapabilityProfile, countByTrust, CAPABILITIES } from "./meddesert";

describe("normalizeState", () => {
  it("strips diacritics + uppercases so geoBoundaries matches NFHS", () => {
    expect(normalizeState("Mahārāshtra")).toBe("MAHARASHTRA");
    expect(normalizeState("Tamil Nādu")).toBe("TAMIL NADU");
    expect(normalizeState("  Bihar ")).toBe("BIHAR");
  });
  it("handles empty", () => {
    expect(normalizeState("")).toBe("");
  });
});

describe("gapColor", () => {
  it("low gap is teal-ish, high gap is red-ish, clamped", () => {
    expect(gapColor(0)).toBe("rgb(44, 125, 160)");
    expect(gapColor(1)).toBe("rgb(155, 34, 38)");
    expect(gapColor(-5)).toBe("rgb(44, 125, 160)");
  });
});

describe("trustLabel", () => {
  it("maps trust keys to human labels", () => {
    expect(trustLabel("strong")).toMatch(/Strong/);
    expect(trustLabel("none")).toMatch(/No claim/);
  });
});

describe("trustClass", () => {
  it("maps known trust keys to their modifier", () => {
    expect(trustClass("strong")).toBe("trust--strong");
    expect(trustClass("none")).toBe("trust--none");
  });
  it("falls back to weak for unknown values", () => {
    expect(trustClass("garbage")).toBe("trust--weak");
  });
});

describe("trustColor", () => {
  it("distinct colors per trust, weak fallback for unknown", () => {
    expect(trustColor("strong")).toBe("#2f9e57");
    expect(trustColor("none")).toBe("#9aa3ad");
    expect(trustColor("???")).toBe(trustColor("weak"));
  });
});

describe("countByTrust", () => {
  it("tallies strong/partial/weak and total, ignoring none/unknown", () => {
    const c = countByTrust([{ trust: "strong" }, { trust: "strong" }, { trust: "partial" }, { trust: "weak" }, { trust: "none" }, { trust: "x" }]);
    expect(c).toEqual({ strong: 2, partial: 1, weak: 1, total: 4 });
  });
  it("handles empty", () => {
    expect(countByTrust([])).toEqual({ strong: 0, partial: 0, weak: 0, total: 0 });
  });
});

describe("orderCapabilityProfile", () => {
  it("ranks by gap desc, pushes data-poor to the end", () => {
    const out = orderCapabilityProfile([
      { capability: "icu", gapScore: 0.1, dataPoor: false, nFacilities: 50, strong: 5 },
      { capability: "trauma", gapScore: 0.9, dataPoor: true, nFacilities: 2, strong: 0 },
      { capability: "maternity", gapScore: 0.3, dataPoor: false, nFacilities: 60, strong: 8 },
    ]);
    expect(out.map((x) => x.capability)).toEqual(["maternity", "icu", "trauma"]);
  });
  it("does not mutate the input", () => {
    const input = [{ capability: "icu", gapScore: 0.1, dataPoor: false, nFacilities: 1, strong: 0 }];
    orderCapabilityProfile(input);
    expect(input[0].capability).toBe("icu");
  });
});

describe("CAPABILITIES", () => {
  it("has the six tracked capabilities", () => {
    expect(CAPABILITIES.map((c) => c.key)).toEqual(["icu", "maternity", "emergency", "oncology", "trauma", "nicu"]);
  });
});
