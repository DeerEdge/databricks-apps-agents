import { describe, it, expect } from "vitest";
import { normalizeState, gapColor, trustLabel, trustClass, trustColor, CAPABILITIES } from "./meddesert";

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

describe("CAPABILITIES", () => {
  it("has the six tracked capabilities", () => {
    expect(CAPABILITIES.map((c) => c.key)).toEqual(["icu", "maternity", "emergency", "oncology", "trauma", "nicu"]);
  });
});
