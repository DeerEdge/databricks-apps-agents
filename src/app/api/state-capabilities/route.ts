import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

// GET /api/state-capabilities?state=Bihar — this state's gap across ALL six capabilities, so a
// planner can see which clinical service is most lacking here (not just the active capability).
export async function GET(req: Request) {
  const state = (new URL(req.url).searchParams.get("state") ?? "").trim();
  if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  try {
    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT capability, n_facilities, strong, gap_score, data_poor
       FROM workspace.meddesert.region_gap
       WHERE upper(trim(state)) = upper(trim(:state))`,
      [{ name: "state", value: state, type: "STRING" }]
    );
    const capabilities = rows.map((r) => ({
      capability: String(r.capability ?? ""),
      nFacilities: Number(r.n_facilities ?? 0),
      strong: Number(r.strong ?? 0),
      gapScore: Number(r.gap_score ?? 0),
      dataPoor: r.data_poor === true || r.data_poor === "true",
    }));
    return NextResponse.json({
      ok: true,
      state,
      capabilities,
      meta: { ms: Date.now() - t0, rows: capabilities.length, source: "workspace.meddesert.region_gap", engine: "Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
