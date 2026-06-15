import { NextResponse } from "next/server";
import { validateOverride } from "@/lib/override";
import { saveOverride, listOverrides, deleteOverride } from "@/lib/lakebase";

export const dynamic = "force-dynamic";

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"];

// GET /api/overrides?capability=icu&state=Bihar — planner trust overrides for that scope.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const capRaw = (url.searchParams.get("capability") ?? "").toLowerCase();
  const capability = CAPS.includes(capRaw) ? capRaw : "";
  const state = (url.searchParams.get("state") ?? "").trim();
  if (!capability || !state) return NextResponse.json({ ok: false, error: "capability and state required" }, { status: 400 });
  try {
    const overrides = await listOverrides(capability, state);
    return NextResponse.json({ ok: true, count: overrides.length, overrides });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// POST /api/overrides — persist a human trust override on a facility×capability.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const v = validateOverride(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  try {
    const override = await saveOverride(v.value);
    return NextResponse.json({ ok: true, override }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// DELETE /api/overrides?id=123 — clear an override.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "valid id required" }, { status: 400 });
  try {
    const removed = await deleteOverride(id);
    return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
