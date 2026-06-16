import { describe, it, expect } from "vitest";
import { abbreviateLabel } from "./stateAbbr";

describe("abbreviateLabel", () => {
  it("maps known states to their 2-letter code", () => {
    expect(abbreviateLabel("Maharashtra")).toBe("MH");
    expect(abbreviateLabel("Tamil Nadu")).toBe("TN");
    expect(abbreviateLabel("Uttar Pradesh")).toBe("UP");
    expect(abbreviateLabel("Meghalaya")).toBe("ML");
  });

  it("matches states case- and whitespace-insensitively", () => {
    expect(abbreviateLabel("  kerala ")).toBe("KL");
    expect(abbreviateLabel("WEST  BENGAL")).toBe("WB");
  });

  it("handles common alternate spellings", () => {
    expect(abbreviateLabel("Orissa")).toBe("OD");
    expect(abbreviateLabel("NCT of Delhi")).toBe("DL");
  });

  it("truncates long non-state labels with an ellipsis", () => {
    expect(abbreviateLabel("Visakhapatnam", 12)).toBe("Visakhapatn…");
    expect(abbreviateLabel("Visakhapatnam", 12).length).toBe(12);
  });

  it("leaves short non-state labels unchanged", () => {
    expect(abbreviateLabel("Pune")).toBe("Pune");
    expect(abbreviateLabel("Salem")).toBe("Salem");
  });

  it("handles empty / whitespace input", () => {
    expect(abbreviateLabel("")).toBe("");
    expect(abbreviateLabel("   ")).toBe("");
  });
});
