import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

// GET /api/districts?state=Bihar — NFHS-5 demand-side need at DISTRICT granularity for a state.
// Demand side only (NFHS-5 is district-level); supply stays state-level until facility→district
// PIN mapping lands (MD2b). Lets a planner see which districts within a gap state need most.
export async function GET(req: Request) {
  const state = (new URL(req.url).searchParams.get("state") ?? "").trim();
  if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  try {
    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT district_name, institutional_birth, insurance_pct, need_index
       FROM workspace.meddesert.district_need
       WHERE state_key = upper(trim(:state))
       ORDER BY need_index DESC`,
      [{ name: "state", value: state, type: "STRING" }]
    );
    const districts = rows.map((r) => ({
      district: String(r.district_name ?? "").trim(),
      institutionalBirth: r.institutional_birth == null ? null : Number(r.institutional_birth),
      insurancePct: r.insurance_pct == null ? null : Number(r.insurance_pct),
      needIndex: Number(r.need_index ?? 0),
    }));
    return NextResponse.json({
      ok: true,
      state,
      count: districts.length,
      districts,
      meta: { ms: Date.now() - t0, rows: districts.length, source: "workspace.meddesert.district_need (NFHS-5)", engine: "Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
