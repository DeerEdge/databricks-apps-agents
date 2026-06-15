import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"] as const;

// GET /api/regions?capability=icu — trust-weighted state coverage + NFHS-5 need + gap score.
// Real care gaps are surfaced; data-poor regions are flagged, not ranked as gaps.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const capRaw = (url.searchParams.get("capability") ?? "icu").toLowerCase();
    const capability = (CAPS as readonly string[]).includes(capRaw) ? capRaw : "icu";

    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT state, n_facilities, strong, partial, weak, supply,
              institutional_birth, insurance_pct, need_index, scarcity, gap_score, data_poor
       FROM workspace.meddesert.region_gap
       WHERE capability = :cap
       ORDER BY data_poor ASC, gap_score DESC`,
      [{ name: "cap", value: capability, type: "STRING" }]
    );
    const ms = Date.now() - t0;

    const regions = rows.map((r) => ({
      state: String(r.state ?? ""),
      nFacilities: Number(r.n_facilities ?? 0),
      strong: Number(r.strong ?? 0),
      partial: Number(r.partial ?? 0),
      weak: Number(r.weak ?? 0),
      supply: Number(r.supply ?? 0),
      institutionalBirth: r.institutional_birth == null ? null : Number(r.institutional_birth),
      insurancePct: r.insurance_pct == null ? null : Number(r.insurance_pct),
      needIndex: Number(r.need_index ?? 0),
      scarcity: Number(r.scarcity ?? 0),
      gapScore: Number(r.gap_score ?? 0),
      dataPoor: r.data_poor === true || r.data_poor === "true",
    }));

    return NextResponse.json({
      ok: true,
      capability,
      count: regions.length,
      regions,
      meta: { ms, rows: regions.length, source: "workspace.meddesert.region_gap", engine: "Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
