import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";
import { normalizePin } from "@/lib/pin";

export const dynamic = "force-dynamic";

const PIN_DIR = "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory";

// GET /api/pin?pin=812001 — resolve a PIN to its district + state via the India Post directory.
// Lets a planner enter a PIN as the geography entry point (state → district → PIN trio).
export async function GET(req: Request) {
  const pin = normalizePin(new URL(req.url).searchParams.get("pin"));
  if (!pin) return NextResponse.json({ ok: false, error: "a valid 6-digit PIN is required" }, { status: 400 });
  try {
    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT any_value(district) AS district, any_value(statename) AS statename,
              any_value(officename) AS office, count(*) AS offices
       FROM ${PIN_DIR}
       WHERE cast(pincode AS STRING) = :pin`,
      [{ name: "pin", value: pin, type: "STRING" }]
    );
    const r = rows[0];
    const district = String(r?.district ?? "").trim();
    if (!district) return NextResponse.json({ ok: false, error: `PIN ${pin} not found in the directory` }, { status: 404 });
    return NextResponse.json({
      ok: true,
      pin,
      district,
      state: String(r?.statename ?? "").trim(),
      office: String(r?.office ?? "").trim(),
      offices: Number(r?.offices ?? 0),
      meta: { ms: Date.now() - t0, source: "india_post_pincode_directory", engine: "Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
