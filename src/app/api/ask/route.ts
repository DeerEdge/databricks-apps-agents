import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";
import { parseQuestion, planSteps } from "@/lib/agent";
import { explainGap, type GapInputs } from "@/lib/reasoning";

export const dynamic = "force-dynamic";

interface Citation { name: string; trust: string; citation: string }

// POST /api/ask { question } — grounded planner agent. Parses the question, runs parameterized
// queries against the gold tables, and returns a cited answer + its reasoning steps.
export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });

  try {
    const t0 = Date.now();
    // 1) capability is keyword-only; pull that capability's regions to get the state list + data.
    const cap0 = parseQuestion(question).capability;
    const { rows } = await runSql(
      `SELECT state, n_facilities, strong, partial, weak, supply,
              institutional_birth, insurance_pct, need_index, scarcity, gap_score, data_poor
       FROM workspace.meddesert.region_gap WHERE capability = :cap`,
      [{ name: "cap", value: cap0, type: "STRING" }]
    );
    const regions: GapInputs[] = rows.map((r) => ({
      state: String(r.state ?? ""),
      nFacilities: Number(r.n_facilities ?? 0),
      strong: Number(r.strong ?? 0), partial: Number(r.partial ?? 0), weak: Number(r.weak ?? 0),
      supply: Number(r.supply ?? 0),
      institutionalBirth: r.institutional_birth == null ? null : Number(r.institutional_birth),
      insurancePct: r.insurance_pct == null ? null : Number(r.insurance_pct),
      needIndex: Number(r.need_index ?? 0), scarcity: Number(r.scarcity ?? 0),
      gapScore: Number(r.gap_score ?? 0), dataPoor: r.data_poor === true || r.data_poor === "true",
    }));

    const parsed = parseQuestion(question, regions.map((r) => r.state));
    const steps = planSteps(parsed);
    const cap = parsed.capabilityLabel;

    let answer = "";
    let citations: Citation[] = [];
    let focusState: string | null = parsed.state;

    if (parsed.intent === "gap_in_state" || parsed.intent === "facility_evidence") {
      const region = regions.find((r) => r.state === parsed.state);
      if (!region) {
        answer = `I have no ${cap} data for ${parsed.state}. Try another state or ask for the worst gaps nationally.`;
      } else {
        citations = await fetchCitations(parsed.capability, region.state);
        const ex = explainGap(region, cap);
        if (region.dataPoor) {
          answer = `${region.state} is **data-poor** for ${cap}, so I won't call it a confirmed gap. ${ex.verdict.reasons.join(" ")} Treat the ${region.nFacilities} records here as unverified.`;
        } else {
          answer = `${region.state} shows a **${cap} care gap of ${region.gapScore.toFixed(2)}** (need ${region.needIndex.toFixed(2)} × scarcity ${region.scarcity.toFixed(2)}). NFHS-5 institutional-birth is ${region.institutionalBirth}%, and only ${region.strong} of ${region.nFacilities} facilities carry strong ${cap} evidence. Below are the cited records.`;
        }
      }
    } else if (parsed.intent === "data_poor") {
      const dp = regions.filter((r) => r.dataPoor).sort((a, b) => b.nFacilities - a.nFacilities).slice(0, 8);
      answer = dp.length
        ? `${dp.length}+ regions are **data-poor** for ${cap} — too little verifiable evidence or no NFHS-5 need data to judge: ${dp.map((r) => r.state).join(", ")}. These should be treated as unknowns, not as "no gap".`
        : `No regions are flagged data-poor for ${cap} — every state has enough evidence to assess.`;
      focusState = dp[0]?.state ?? null;
    } else {
      // top_gaps
      const top = regions.filter((r) => !r.dataPoor).sort((a, b) => b.gapScore - a.gapScore).slice(0, 5);
      answer = top.length
        ? `The worst **real ${cap} care gaps** (data-poor regions excluded) are: ${top.map((r, i) => `${i + 1}. ${r.state} (gap ${r.gapScore.toFixed(2)}, ${r.strong} strong / ${r.nFacilities} facilities)`).join("; ")}. Ranked by NFHS-5 need × trust-weighted scarcity.`
        : `I couldn't find rankable ${cap} gaps — the data may be too sparse.`;
      focusState = top[0]?.state ?? null;
    }

    return NextResponse.json({
      ok: true,
      question,
      parsed,
      steps,
      answer,
      citations,
      focusState,
      meta: { ms: Date.now() - t0, rows: regions.length, source: "workspace.meddesert.region_gap + facility_capability", engine: "grounded agent · Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
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
