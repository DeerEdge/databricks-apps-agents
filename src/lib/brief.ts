// Pure: render a saved planning scenario as a shareable, cited Markdown brief.
// No DOM / DB → testable. Every claim traces to the facility's own captured free-text.

export interface BriefScenario {
  capability: string;
  state: string;
  createdAt: string;
  gapScore: number | null;
  dataPoor: boolean;
  nFacilities: number;
  note: string;
  evidence: { name: string; trust: string; citation: string }[];
}

const isoDay = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
};

export function scenarioBrief(s: BriefScenario): string {
  const cap = (s.capability || "").toUpperCase();
  const lines: string[] = [
    `# Planning scenario — ${cap} in ${s.state}`,
    "",
    `*Saved ${isoDay(s.createdAt)} · Medical Desert Planner (Virtue Foundation × NFHS-5, via Databricks)*`,
    "",
    s.dataPoor
      ? "**Status:** data-poor region — evidence is too sparse (or NFHS-5 need data is missing) to confirm a real gap. Treat as an unknown, not as \"no gap\"."
      : `**Care-gap score:** ${s.gapScore != null ? s.gapScore.toFixed(2) : "—"} — NFHS-5 demand-side need × trust-weighted facility scarcity.`,
    `**Facilities on record (${cap}):** ${s.nFacilities}`,
  ];
  if (s.note.trim()) {
    lines.push("", `**Planner note:** ${s.note.trim()}`);
  }
  lines.push("", `## Cited evidence (${s.evidence.length})`);
  if (s.evidence.length === 0) {
    lines.push("_No facility evidence was captured for this scenario._");
  } else {
    for (const e of s.evidence) {
      const cite = e.citation ? `: “${e.citation}”` : "";
      lines.push(`- **${e.name || "Facility"}** — _${e.trust}_${cite}`);
    }
  }
  lines.push(
    "",
    "_Trust signals: strong = structured specialty code and a claim agree; partial = one source; weak = mentioned only in free-text. Facility fields are claims to verify, not ground truth._"
  );
  return lines.join("\n");
}
