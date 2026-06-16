import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";
import { askGenie } from "@/lib/genie";
import { parseQuestion, planSteps, type ParsedQuestion } from "@/lib/agent";
import { inferChartSpec } from "@/lib/chartSpec";

export const dynamic = "force-dynamic";

interface Citation { name: string; trust: string; citation: string }

interface RegionRow {
  state: string;
  nFacilities: number;
  gapScore: number;
  dataPoor: boolean;
}

// POST /api/ask { question } — Genie-backed planner agent. Genie answers the question and, when it
// runs SQL, returns the result we visualize as a chart. We still parse the question locally to sync
// the map (capability + focus state) and to attach cited facility evidence for that region.
export async function POST(req: Request) {
  let body: { question?: string; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });
  // Optional: continue an existing Genie conversation (follow-up turn) instead of starting fresh.
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : undefined;

  try {
    const t0 = Date.now();
    const cap0 = parseQuestion(question).capability;

    // Ask Genie and pull the capability's regions in parallel — the regions give us the known-state
    // list (for question parsing) and drive map focus + citations.
    const [genie, regionRes] = await Promise.all([
      askGenie(question, conversationId),
      runSql(
        `SELECT state, n_facilities, gap_score, data_poor
         FROM workspace.meddesert.region_gap WHERE capability = :cap`,
        [{ name: "cap", value: cap0, type: "STRING" }]
      ),
    ]);

    const regions: RegionRow[] = regionRes.rows.map((r) => ({
      state: String(r.state ?? ""),
      nFacilities: Number(r.n_facilities ?? 0),
      gapScore: Number(r.gap_score ?? 0),
      dataPoor: r.data_poor === true || r.data_poor === "true",
    }));

    const parsed = parseQuestion(question, regions.map((r) => r.state));
    const steps = planSteps(parsed);
    const focusState = computeFocus(parsed, regions);

    const citations: Citation[] = focusState
      ? await fetchCitations(parsed.capability, focusState)
      : [];

    const chart = genie.query ? inferChartSpec(genie.query.columns, genie.query.rows) : null;
    const answer = genie.text || `I couldn't find an answer for that ${parsed.capabilityLabel} question.`;

    return NextResponse.json({
      ok: true,
      question,
      parsed,
      steps,
      answer,
      chart,
      citations,
      focusState,
      conversationId: genie.conversationId,
      meta: { ms: Date.now() - t0, rows: regions.length, source: "Databricks Genie + workspace.meddesert", engine: "Databricks Genie" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// Which region the map should focus and which region's evidence we cite: the named state if any,
// otherwise the worst real gap (or, for data-poor questions, the largest data-poor region).
function computeFocus(parsed: ParsedQuestion, regions: RegionRow[]): string | null {
  if (parsed.intent === "compare") {
    const found = parsed.states
      .map((s) => regions.find((r) => r.state === s))
      .filter((r): r is RegionRow => Boolean(r));
    const worse = found.filter((r) => !r.dataPoor).sort((a, b) => b.gapScore - a.gapScore)[0];
    return worse?.state ?? found[0]?.state ?? parsed.state;
  }
  if (parsed.state) return parsed.state;
  if (parsed.intent === "data_poor") {
    return regions.filter((r) => r.dataPoor).sort((a, b) => b.nFacilities - a.nFacilities)[0]?.state ?? null;
  }
  return regions.filter((r) => !r.dataPoor).sort((a, b) => b.gapScore - a.gapScore)[0]?.state ?? null;
}

async function fetchCitations(capability: string, state: string): Promise<Citation[]> {
  const { rows } = await runSql(
    `SELECT name, trust, citation FROM workspace.meddesert.facility_capability
     WHERE capability = :cap AND upper(trim(state)) = upper(trim(:state)) AND trust <> 'none'
     ORDER BY CASE trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 WHEN 'weak' THEN 2 ELSE 3 END,
              length(coalesce(citation,'')) DESC
     LIMIT 4`,
    [{ name: "cap", value: capability, type: "STRING" }, { name: "state", value: state, type: "STRING" }]
  );
  return rows
    .map((r) => ({ name: String(r.name ?? ""), trust: String(r.trust ?? ""), citation: String(r.citation ?? "").trim() }))
    .filter((c) => c.citation);
}
