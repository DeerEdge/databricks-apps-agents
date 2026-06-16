import { describe, it, expect } from "vitest";
import { parseQuestion, detectCapability, detectState, detectStates, planSteps } from "./agent";

const STATES = ["Bihar", "Kerala", "Tamil Nadu", "Meghalaya", "Uttar Pradesh"];

describe("detectCapability", () => {
  it("maps synonyms to canonical capabilities", () => {
    expect(detectCapability("where is cancer care weak?")).toBe("oncology");
    expect(detectCapability("neonatal coverage")).toBe("nicu");
    expect(detectCapability("maternal health gaps")).toBe("maternity");
    expect(detectCapability("emergency rooms")).toBe("emergency");
  });
  it("defaults to icu when nothing matches", () => {
    expect(detectCapability("how is healthcare overall")).toBe("icu");
  });
});

describe("detectState", () => {
  it("finds a known state regardless of case/diacritics", () => {
    expect(detectState("gaps in bihar please", STATES)).toBe("Bihar");
    expect(detectState("Tamil Nadu trauma", STATES)).toBe("Tamil Nadu");
  });
  it("returns null when no known state is mentioned", () => {
    expect(detectState("worst gaps nationally", STATES)).toBe(null);
  });
});

describe("detectStates", () => {
  it("finds multiple states in question order", () => {
    expect(detectStates("compare Kerala and Bihar", STATES)).toEqual(["Kerala", "Bihar"]);
  });
  it("does not double-count a substring of a longer match", () => {
    // "Bihar" only; ensure no phantom extra
    expect(detectStates("gaps in Bihar", STATES)).toEqual(["Bihar"]);
  });
  it("returns [] when none mentioned", () => {
    expect(detectStates("worst gaps nationally", STATES)).toEqual([]);
  });
});

describe("parseQuestion", () => {
  it("gap_in_state when a state is named", () => {
    const p = parseQuestion("where are the ICU gaps in Bihar?", STATES);
    expect(p).toMatchObject({ intent: "gap_in_state", capability: "icu", state: "Bihar" });
  });
  it("top_gaps when national", () => {
    expect(parseQuestion("worst maternity gaps in India", STATES).intent).toBe("top_gaps");
  });
  it("data_poor when uncertainty is asked about", () => {
    expect(parseQuestion("which trauma regions are data-poor?", STATES).intent).toBe("data_poor");
  });
  it("facility_evidence when facilities + a state are asked (incl. plural 'hospitals')", () => {
    const p = parseQuestion("show ICU hospitals in Kerala", STATES);
    expect(p.intent).toBe("facility_evidence");
    expect(p.state).toBe("Kerala");
  });
  it("compare when two states + a compare cue are present", () => {
    const p = parseQuestion("compare ICU in Bihar and Kerala", STATES);
    expect(p.intent).toBe("compare");
    expect(p.states).toEqual(["Bihar", "Kerala"]);
  });
  it("two states without a compare cue stays gap_in_state (first state)", () => {
    const p = parseQuestion("ICU gaps in Bihar near Kerala border", STATES);
    expect(p.intent).toBe("gap_in_state");
  });
});

describe("planSteps", () => {
  it("always starts by interpreting and ends by composing", () => {
    const steps = planSteps(parseQuestion("ICU gaps in Bihar", STATES));
    expect(steps[0]).toMatch(/Interpret/);
    expect(steps[steps.length - 1]).toMatch(/grounded, cited answer/);
  });
  it("includes a facility_capability call for evidence queries", () => {
    const steps = planSteps(parseQuestion("show ICU hospitals in Kerala", STATES));
    expect(steps.some((s) => /facility_capability/.test(s))).toBe(true);
  });
});
