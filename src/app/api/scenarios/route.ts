import { NextResponse } from "next/server";
import { validateScenario } from "@/lib/scenario";
import { saveScenario, listScenarios, deleteScenario } from "@/lib/lakebase";

export const dynamic = "force-dynamic";

// GET /api/scenarios — list saved planning scenarios (newest first), from Lakebase.
export async function GET() {
  try {
    const scenarios = await listScenarios();
    return NextResponse.json({ ok: true, count: scenarios.length, scenarios });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// POST /api/scenarios — persist a planning scenario (capability × state + cited evidence + note).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const v = validateScenario(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  try {
    const scenario = await saveScenario(v.value);
    return NextResponse.json({ ok: true, scenario }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// DELETE /api/scenarios?id=123 — remove a saved scenario.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "valid id required" }, { status: 400 });
  try {
    const removed = await deleteScenario(id);
    return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
