import { describe, it, expect } from "vitest";
import { validateOverride } from "./override";

const good = { facilityName: "Woodland Hospital", capability: "ICU", state: "Meghalaya", overrideTrust: "weak", note: "claim unverifiable on call" };

describe("validateOverride", () => {
  it("accepts and normalizes a valid override", () => {
    const r = validateOverride(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capability).toBe("icu");
      expect(r.value.overrideTrust).toBe("weak");
    }
  });
  it("requires a facility name", () => {
    expect(validateOverride({ ...good, facilityName: "  " })).toEqual({ ok: false, error: "facilityName required" });
  });
  it("rejects an invalid capability", () => {
    expect(validateOverride({ ...good, capability: "xray" })).toEqual({ ok: false, error: "invalid capability" });
  });
  it("rejects an invalid trust value", () => {
    expect(validateOverride({ ...good, overrideTrust: "great" })).toEqual({ ok: false, error: "invalid overrideTrust" });
  });
  it("clamps an over-long note", () => {
    const r = validateOverride({ ...good, note: "x".repeat(2000) });
    expect(r.ok && r.value.note.length).toBe(1000);
  });
});
