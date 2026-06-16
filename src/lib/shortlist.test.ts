import { describe, it, expect } from "vitest";
import { validateShortlistItem } from "./shortlist";

const good = { facilityName: "Woodland Hospital", capability: "ICU", state: "Meghalaya", trust: "strong", citation: "Has 14 ICU beds" };

describe("validateShortlistItem", () => {
  it("accepts and normalizes a valid item", () => {
    const r = validateShortlistItem(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capability).toBe("icu");
      expect(r.value.trust).toBe("strong");
      expect(r.value.facilityName).toBe("Woodland Hospital");
    }
  });
  it("requires a facility name", () => {
    expect(validateShortlistItem({ ...good, facilityName: "  " })).toEqual({ ok: false, error: "facilityName required" });
  });
  it("rejects an invalid capability", () => {
    expect(validateShortlistItem({ ...good, capability: "xray" })).toEqual({ ok: false, error: "invalid capability" });
  });
  it("requires a state", () => {
    expect(validateShortlistItem({ ...good, state: "" })).toEqual({ ok: false, error: "state required" });
  });
  it("defaults an odd trust to weak and clamps a long citation", () => {
    const r = validateShortlistItem({ ...good, trust: "amazing", citation: "x".repeat(900) });
    expect(r.ok && r.value.trust).toBe("weak");
    expect(r.ok && r.value.citation.length).toBe(500);
  });
});
