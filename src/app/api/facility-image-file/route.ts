import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;

// GET /api/facility-image-file?path=/Volumes/workspace/meddesert/images/...
// Proxy for thumbnails stored in Databricks Volumes (not publicly accessible).
// Returns the raw JPEG bytes with appropriate caching headers.
export async function GET(req: Request) {
  const rawPath = new URL(req.url).searchParams.get("path") ?? "";
  // Validate: must start with /Volumes/ to prevent arbitrary path traversal
  if (!rawPath.startsWith("/Volumes/")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (!HOST || !TOKEN) {
    return NextResponse.json({ error: "Databricks not configured" }, { status: 503 });
  }

  const encoded = rawPath.replace(/^\//, ""); // strip leading /
  const url = `${HOST}/api/2.0/fs/files/${encoded}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
    if (!resp.ok) {
      return new NextResponse(null, { status: resp.status });
    }
    const bytes = await resp.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        // Cache thumbnails aggressively — they never change after upload
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
