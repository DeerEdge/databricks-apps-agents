// Pure logic for the planner agent: understand a natural-language question, then plan the
// tool calls (parameterized SQL) needed to answer it with cited evidence. No DB / DOM here —
// the API route executes the plan; this module decides intent, capability, geography, steps.

import { CAPABILITIES, normalizeState } from "./meddesert";

export type Intent = "gap_in_state" | "top_gaps" | "data_poor" | "facility_evidence" | "compare";

export interface ParsedQuestion {
  intent: Intent;
  capability: string; // always resolved (defaults to icu)
  capabilityLabel: string;
  state: string | null; // primary matched state, else null
  states: string[]; // all matched states (for compare); [] or [state] otherwise
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

// Tokenized form: uppercase, diacritic-free, punctuation→spaces, space-padded. Lets us match a
// state as whole tokens ("Bihar?" still matches "BIHAR"; "Mp" never matches inside "coMPare").
function toTokens(x: string): string {
  return ` ${normalizeState(x).replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** Match a known state name inside the question (diacritic-insensitive, longest match wins). */
export function detectState(q: string, knownStates: string[]): string | null {
  const pq = toTokens(q);
  let best: { name: string; len: number } | null = null;
  for (const s of knownStates) {
    const ns = toTokens(s).trim();
    if (ns && pq.includes(` ${ns} `) && (!best || ns.length > best.len)) best = { name: s, len: ns.length };
  }
  return best?.name ?? null;
}

/** All distinct known states mentioned, in the order they appear in the question.
 *  Skips a state name fully contained in a longer matched one (e.g. avoid double-counting). */
export function detectStates(q: string, knownStates: string[]): string[] {
  const pq = toTokens(q);
  const hits = knownStates
    .map((s) => ({ s, ns: toTokens(s).trim() }))
    .filter((x) => x.ns && pq.includes(` ${x.ns} `))
    // longest first so a longer name claims its position before a substring match
    .sort((a, b) => b.ns.length - a.ns.length);
  const taken: string[] = [];
  const out: { s: string; at: number }[] = [];
  for (const { s, ns } of hits) {
    if (taken.some((t) => t.includes(ns) || ns.includes(t))) continue;
    taken.push(ns);
    out.push({ s, at: pq.indexOf(` ${ns} `) });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.s);
}

/** Classify the planner's question into one of five answerable intents. */
export function parseQuestion(q: string, knownStates: string[] = []): ParsedQuestion {
  const lower = q.toLowerCase();
  const capability = detectCapability(q);
  const capabilityLabel = CAPABILITIES.find((c) => c.key === capability)?.label ?? capability.toUpperCase();
  const states = detectStates(q, knownStates);
  const state = states[0] ?? null;
  const wantsCompare = /\b(compare|versus|vs\.?|against|better|worse|or)\b/.test(lower);

  let intent: Intent;
  if (states.length >= 2 && wantsCompare) {
    intent = "compare";
  } else if (/\b(data[- ]?poor|sparse|missing data|under[- ]?report|no data|uncertain)\b/.test(lower)) {
    intent = "data_poor";
  } else if (/(facilit|hospital|clinic|which ones|show me|list )/.test(lower) && state) {
    intent = "facility_evidence";
  } else if (state) {
    intent = "gap_in_state";
  } else {
    intent = "top_gaps";
  }
  return { intent, capability, capabilityLabel, state, states: intent === "compare" ? states.slice(0, 2) : state ? [state] : [] };
}

/** Human-readable plan of the tool calls the agent will run — streamed as chain-of-thought. */
export function planSteps(p: ParsedQuestion): string[] {
  const scope = p.intent === "compare" ? `, comparing **${p.states.join("** vs **")}**`
    : p.state ? `, state **${p.state}**` : ", national scope";
  const steps = [`Interpret question → capability **${p.capabilityLabel}**${scope}`];
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
    case "compare":
      steps.push(`Query \`region_gap\` for ${p.states.join(" and ")} × ${p.capabilityLabel}`);
      steps.push("Contrast need, trust-weighted supply, and gap score");
      steps.push("Name the higher-gap region and pull its cited evidence");
      break;
  }
  steps.push("Compose a grounded, cited answer");
  return steps;
}
