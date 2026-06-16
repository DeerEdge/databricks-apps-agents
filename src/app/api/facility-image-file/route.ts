import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;

// Confine reads to this app's own Volume namespace (overridable per workspace). The image
// paths come from workspace.meddesert.hospital_map_assets.primary_image_url, all under here.
const VOLUME_ROOT = process.env.DATABRICKS_VOLUMES_PATH ?? "/Volumes/workspace/meddesert";

// GET /api/facility-image-file?path=/Volumes/workspace/meddesert/images/...
// Proxy for thumbnails stored in Databricks Volumes (not publicly accessible).
// Returns the raw JPEG bytes with appropriate caching headers.
export async function GET(req: Request) {
  const rawPath = new URL(req.url).searchParams.get("path") ?? "";
  // Fail closed against path traversal / SSRF: the proxy holds a privileged token, so confine
  // strictly to our Volume, JPEG only, and reject any traversal / encoding tricks. searchParams
  // already decodes once, so a literal "%" here means double-encoding — reject it too.
  const lower = rawPath.toLowerCase();
  const safe =
    rawPath.startsWith(VOLUME_ROOT + "/") &&
    !rawPath.includes("..") &&
    !rawPath.includes("\0") &&
    !rawPath.includes("\\") &&
    !rawPath.includes("%") &&
    (lower.endsWith(".jpg") || lower.endsWith(".jpeg"));
  if (!safe) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (!HOST || !TOKEN) {
    return NextResponse.json({ error: "Databricks not configured" }, { status: 503 });
  }

  // Encode each segment (preserving the path separators) before interpolating into the API URL.
  const encoded = rawPath.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
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
