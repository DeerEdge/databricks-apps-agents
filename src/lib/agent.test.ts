import { describe, it, expect } from "vitest";
import { parseQuestion, detectCapability, detectState, planSteps } from "./agent";

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
