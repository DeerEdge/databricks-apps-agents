import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"];

// GET /api/districts?capability=icu&state=Bihar — DISTRICT-level gap for a state:
// facility supply (mapped to district via PIN postcode) × NFHS-5 demand. Real gaps vs data-poor
// at district granularity. Citations stay at the facility level (drill-in).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const capRaw = (url.searchParams.get("capability") ?? "icu").toLowerCase();
  const capability = CAPS.includes(capRaw) ? capRaw : "icu";
  const state = (url.searchParams.get("state") ?? "").trim();
  if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  try {
    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT district, n_facilities, strong, partial, weak, supply,
              institutional_birth, need_index, scarcity, gap_score, data_poor
       FROM workspace.meddesert.district_gap
       WHERE capability = :cap AND state_key = upper(trim(:state))
       ORDER BY data_poor ASC, gap_score DESC`,
      [{ name: "cap", value: capability, type: "STRING" }, { name: "state", value: state, type: "STRING" }]
    );
    const districts = rows.map((r) => ({
      district: String(r.district ?? "").trim(),
      nFacilities: Number(r.n_facilities ?? 0),
      strong: Number(r.strong ?? 0),
      supply: Number(r.supply ?? 0),
      institutionalBirth: r.institutional_birth == null ? null : Number(r.institutional_birth),
      needIndex: r.need_index == null ? null : Number(r.need_index),
      scarcity: Number(r.scarcity ?? 0),
      gapScore: Number(r.gap_score ?? 0),
      dataPoor: r.data_poor === true || r.data_poor === "true",
    }));
    return NextResponse.json({
      ok: true,
      capability,
      state,
      count: districts.length,
      districts,
      meta: { ms: Date.now() - t0, rows: districts.length, source: "workspace.meddesert.district_gap (PIN + NFHS-5)", engine: "Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
