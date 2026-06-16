import { NextResponse } from "next/server";
import { validateShortlistItem } from "@/lib/shortlist";
import { saveShortlistItem, listShortlist, deleteShortlistItem } from "@/lib/lakebase";

export const dynamic = "force-dynamic";

// GET /api/shortlist — the planner's saved facility shortlist (newest first), from Lakebase.
export async function GET() {
  try {
    const items = await listShortlist();
    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// POST /api/shortlist — add a facility to the shortlist (idempotent per facility×capability×state).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const v = validateShortlistItem(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  try {
    const item = await saveShortlistItem(v.value);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// DELETE /api/shortlist?id=123 — remove a shortlisted facility.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "valid id required" }, { status: 400 });
  try {
    const removed = await deleteShortlistItem(id);
    return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
