import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"] as const;

// GET /api/facilities?capability=icu&state=Bihar — the facility records behind a regional
// aggregate, ordered by trust, each carrying the cited facility text. Evidence drill-in.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const capRaw = (url.searchParams.get("capability") ?? "icu").toLowerCase();
    const capability = (CAPS as readonly string[]).includes(capRaw) ? capRaw : "icu";
    const state = (url.searchParams.get("state") ?? "").trim();
    if (!state) return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });

    const { rows } = await runSql(
      `SELECT name, city, trust, citation, structured, claim, latitude, longitude
       FROM workspace.meddesert.facility_capability
       WHERE capability = :cap AND upper(trim(state)) = upper(trim(:state))
             AND trust <> 'none'
       ORDER BY CASE trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 WHEN 'weak' THEN 2 ELSE 3 END,
                length(coalesce(citation,'')) DESC
       LIMIT 60`,
      [
        { name: "cap", value: capability, type: "STRING" },
        { name: "state", value: state, type: "STRING" },
      ]
    );

    const facilities = rows.map((r) => ({
      name: String(r.name ?? ""),
      city: String(r.city ?? ""),
      trust: String(r.trust ?? ""),
      citation: String(r.citation ?? "").trim(),
      structured: r.structured === true || r.structured === "true",
      claim: r.claim === true || r.claim === "true",
    }));

    return NextResponse.json({ ok: true, capability, state, count: facilities.length, facilities });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
