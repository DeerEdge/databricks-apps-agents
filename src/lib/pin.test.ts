import { describe, it, expect } from "vitest";
import { normalizePin } from "./pin";

describe("normalizePin", () => {
  it("accepts a clean 6-digit PIN", () => {
    expect(normalizePin("812001")).toBe("812001");
  });
  it("strips spaces/dashes and other non-digits", () => {
    expect(normalizePin(" 81 20-01 ")).toBe("812001");
    expect(normalizePin("PIN: 560001")).toBe("560001");
  });
  it("rejects wrong length", () => {
    expect(normalizePin("8120")).toBe(null);
    expect(normalizePin("8120011")).toBe(null);
  });
  it("rejects a PIN starting with 0 (invalid in India)", () => {
    expect(normalizePin("012345")).toBe(null);
  });
  it("rejects empty / nullish", () => {
    expect(normalizePin("")).toBe(null);
    expect(normalizePin(null)).toBe(null);
  });
});
