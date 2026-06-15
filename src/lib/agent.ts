// Pure logic for the planner agent: understand a natural-language question, then plan the
// tool calls (parameterized SQL) needed to answer it with cited evidence. No DB / DOM here —
// the API route executes the plan; this module decides intent, capability, geography, steps.

import { CAPABILITIES, normalizeState } from "./meddesert";

export type Intent = "gap_in_state" | "top_gaps" | "data_poor" | "facility_evidence";

export interface ParsedQuestion {
  intent: Intent;
  capability: string; // always resolved (defaults to icu)
  capabilityLabel: string;
  state: string | null; // matched against known states, else null
}

const SYNONYMS: Record<string, string> = {
  icu: "icu", "intensive care": "icu", critical: "icu",
  maternity: "maternity", maternal: "maternity", obstetric: "maternity", delivery: "maternity", birth: "maternity",
  emergency: "emergency", er: "emergency", casualty: "emergency",
  oncology: "oncology", cancer: "oncology", tumour: "oncology", tumor: "oncology", chemo: "oncology",
  trauma: "trauma", accident: "trauma",
  nicu: "nicu", neonatal: "nicu", newborn: "nicu",
};

/** Resolve the capability mentioned in a question (default icu).
 *  Whole-word match so short terms like "er" don't match "where"/"over". */
export function detectCapability(q: string): string {
  const lower = q.toLowerCase();
  for (const [term, cap] of Object.entries(SYNONYMS)) {
    if (new RegExp(`\\b${term}\\b`).test(lower)) return cap;
  }
  return "icu";
}

/** Match a known state name inside the question (diacritic-insensitive, longest match wins). */
export function detectState(q: string, knownStates: string[]): string | null {
  const nq = normalizeState(q);
  let best: string | null = null;
  for (const s of knownStates) {
    const ns = normalizeState(s);
    if (ns && nq.includes(ns) && (!best || ns.length > normalizeState(best).length)) best = s;
  }
  return best;
}

/** Classify the planner's question into one of four answerable intents. */
export function parseQuestion(q: string, knownStates: string[] = []): ParsedQuestion {
  const lower = q.toLowerCase();
  const capability = detectCapability(q);
  const capabilityLabel = CAPABILITIES.find((c) => c.key === capability)?.label ?? capability.toUpperCase();
  const state = detectState(q, knownStates);

  let intent: Intent;
  if (/\b(data[- ]?poor|sparse|missing data|under[- ]?report|no data|uncertain)\b/.test(lower)) {
    intent = "data_poor";
  } else if (/(facilit|hospital|clinic|which ones|show me|list )/.test(lower) && state) {
    intent = "facility_evidence";
  } else if (state) {
    intent = "gap_in_state";
  } else {
    intent = "top_gaps";
  }
  return { intent, capability, capabilityLabel, state };
}

/** Human-readable plan of the tool calls the agent will run — streamed as chain-of-thought. */
export function planSteps(p: ParsedQuestion): string[] {
  const steps = [`Interpret question → capability **${p.capabilityLabel}**${p.state ? `, state **${p.state}**` : ", national scope"}`];
  switch (p.intent) {
    case "gap_in_state":
      steps.push(`Query \`region_gap\` for ${p.state} × ${p.capabilityLabel} (parameterized)`);
      steps.push(`Pull the cited facility records behind the score from \`facility_capability\``);
      steps.push("Explain the gap-score derivation and assess confidence");
      break;
    case "top_gaps":
      steps.push(`Query \`region_gap\` for the worst real ${p.capabilityLabel} gaps (data-poor excluded)`);
      steps.push("Rank by gap score and summarize the drivers");
      break;
    case "data_poor":
      steps.push(`Query \`region_gap\` for ${p.capabilityLabel} regions flagged data-poor`);
      steps.push("Explain why each is too uncertain to rank");
      break;
    case "facility_evidence":
      steps.push(`Query \`facility_capability\` for ${p.capabilityLabel} facilities in ${p.state}`);
      steps.push("Order by trust and attach the cited facility text");
      break;
  }
  steps.push("Compose a grounded, cited answer");
  return steps;
}
