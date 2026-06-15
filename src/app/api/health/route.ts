import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

// GET /api/health — proves the Databricks round-trip works from the app.
export async function GET() {
  try {
    const { rows } = await runSql("SELECT 1 AS ok, current_date() AS today");
    return NextResponse.json({
      ok: true,
      databricks: "reachable",
      today: rows[0]?.today ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
