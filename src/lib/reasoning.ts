// Pure "chain of thought" behind a regional gap score. No DB / DOM → testable.
// Mirrors the EXACT formula in scripts/ingest_facilities.py (region_gap):
//   supply     = 1·strong + 0.5·partial + 0.2·weak
//   need_index = (100 − institutional_birth%) ÷ 100        (0.5 if no NFHS data)
//   scarcity   = 1 − supply ÷ max(supply over states for this capability)
//   gap_score  = need_index × scarcity
//   data_poor  = (strong+partial = 0)  OR  (n_facilities < 10)  OR  (no NFHS data)

export interface GapInputs {
  state: string;
  nFacilities: number;
  strong: number;
  partial: number;
  weak: number;
  supply: number;
  institutionalBirth: number | null;
  insurancePct: number | null;
  needIndex: number;
  scarcity: number;
  gapScore: number;
  dataPoor: boolean;
}

export interface ReasonStep {
  n: number;
  label: string;
  formula: string;
  value: string;
  detail: string;
}

export interface GapExplanation {
  steps: ReasonStep[];
  verdict: { kind: "real-gap" | "data-poor"; headline: string; reasons: string[] };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Build the ordered, plain-language derivation of a state's gap score for a capability. */
export function explainGap(r: GapInputs, capLabel: string): GapExplanation {
  const hasNfhs = r.institutionalBirth != null;
  // scarcity = 1 − supply/maxSupply ⇒ this state's supply as a share of the best-served state.
  const supplyShare = r.scarcity < 1 ? 1 - r.scarcity : 0;

  const steps: ReasonStep[] = [
    {
      n: 1,
      label: "NFHS-5 demand-side need",
      formula: "need = (100 − institutional-birth %) ÷ 100",
      value: r.needIndex.toFixed(3),
      detail: hasNfhs
        ? `Institutional-birth ${r.institutionalBirth}%${r.insurancePct != null ? `, insurance ${r.insurancePct}%` : ""} → lower coverage means higher unmet need.`
        : "No NFHS-5 indicators for this state → need defaults to 0.5 (we cannot judge demand).",
    },
    {
      n: 2,
      label: "Trust-weighted facility supply",
      formula: "supply = 1·strong + 0.5·partial + 0.2·weak",
      value: r.supply.toFixed(1),
      detail: `${r.strong} strong, ${r.partial} partial, ${r.weak} weak ${capLabel} claims across ${r.nFacilities} facilities — weaker evidence counts for less.`,
    },
    {
      n: 3,
      label: "Scarcity vs best-served state",
      formula: "scarcity = 1 − supply ÷ max state supply",
      value: r.scarcity.toFixed(3),
      detail: `This state's ${capLabel} supply is ${pct(supplyShare)} of the best-served state — the rest is the gap.`,
    },
    {
      n: 4,
      label: "Gap score",
      formula: "gap = need × scarcity",
      value: r.gapScore.toFixed(3),
      detail: "Higher means greater verified-supply shortfall against real demand.",
    },
  ];

  const reasons: string[] = [];
  if (r.dataPoor) {
    if (r.strong + r.partial === 0) reasons.push(`No facility carries verifiable ${capLabel} evidence (0 strong/partial).`);
    if (r.nFacilities < 10) reasons.push(`Only ${r.nFacilities} facilities on record (< 10) — too sparse to trust.`);
    if (!hasNfhs) reasons.push("No NFHS-5 need data for this state.");
    return {
      steps,
      verdict: {
        kind: "data-poor",
        headline: "Data-poor — shown grey, not ranked as a real gap",
        reasons,
      },
    };
  }

  return {
    steps,
    verdict: {
      kind: "real-gap",
      headline: "Real care gap — enough evidence and NFHS-5 need to rank",
      reasons: [
        `${r.nFacilities} facilities, incl. ${r.strong} with strong evidence.`,
        hasNfhs ? `NFHS-5 institutional-birth ${r.institutionalBirth}% → need ${r.needIndex.toFixed(2)}.` : "",
        `Gap score ${r.gapScore.toFixed(2)} (need × scarcity).`,
      ].filter(Boolean),
    },
  };
}
