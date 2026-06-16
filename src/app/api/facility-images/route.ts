import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";

export const dynamic = "force-dynamic";

export interface FacilityImageAsset {
  hospitalName: string;
  city: string;
  state: string;
  primaryImageUrl: string | null;
  imageAvailable: boolean;
  confidence: number;
  galleryCount: number;
  hasIcuImage: boolean;
}

// GET /api/facility-images?state=Bihar
// Returns one map-asset record per hospital in the state that has a verified image.
// Used by the map to enrich facility popups without extra per-facility round trips.
export async function GET(req: Request) {
  const state = (new URL(req.url).searchParams.get("state") ?? "").trim();
  if (!state) {
    return NextResponse.json({ ok: false, error: "state required" }, { status: 400 });
  }

  try {
    const t0 = Date.now();
    const { rows } = await runSql(
      `SELECT hospital_name, city, state, primary_image_url,
              image_available, confidence, gallery_count, has_icu_image
       FROM   workspace.meddesert.hospital_map_assets
       WHERE  upper(trim(state)) = upper(trim(:state))
              AND image_available = true
       ORDER  BY confidence DESC
       LIMIT  200`,
      [{ name: "state", value: state, type: "STRING" }]
    );

    const assets: FacilityImageAsset[] = rows.map((r) => ({
      hospitalName: String(r.hospital_name ?? ""),
      city: String(r.city ?? ""),
      state: String(r.state ?? ""),
      primaryImageUrl: r.primary_image_url ? String(r.primary_image_url) : null,
      imageAvailable: r.image_available === true || r.image_available === "true",
      confidence: r.confidence == null ? 0 : Number(r.confidence),
      galleryCount: r.gallery_count == null ? 0 : Number(r.gallery_count),
      hasIcuImage: r.has_icu_image === true || r.has_icu_image === "true",
    }));

    return NextResponse.json({
      ok: true,
      state,
      count: assets.length,
      assets,
      meta: {
        ms: Date.now() - t0,
        source: "workspace.meddesert.hospital_map_assets",
        engine: "Databricks SQL",
      },
    });
  } catch (e) {
    // If the table doesn't exist yet (pipeline hasn't run), return an empty list
    // rather than a 500 — the map degrades gracefully to text-only popups.
    const msg = e instanceof Error ? e.message : "unknown error";
    if (msg.includes("TABLE_OR_VIEW_NOT_FOUND") || msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true,
        state,
        count: 0,
        assets: [],
        meta: { ms: 0, note: "enrichment table not yet created — run enrich_images.py" },
      });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
