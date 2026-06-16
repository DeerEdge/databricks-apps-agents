import { describe, it, expect } from "vitest";
import { GET } from "./route";

const call = (path: string) =>
  GET(new Request(`http://x/api/facility-image-file?path=${encodeURIComponent(path)}`));

describe("GET /api/facility-image-file — path validation (SSRF/traversal)", () => {
  it("rejects a path outside the meddesert volume root (400)", async () => {
    const res = await call("/Volumes/workspace/other/secrets.jpg");
    expect(res.status).toBe(400);
  });

  it("rejects a non-/Volumes path (400)", async () => {
    const res = await call("/etc/passwd.jpg");
    expect(res.status).toBe(400);
  });

  it("rejects '..' traversal even under the root (400)", async () => {
    const res = await call("/Volumes/workspace/meddesert/../../etc/passwd.jpg");
    expect(res.status).toBe(400);
  });

  it("rejects a backslash (400)", async () => {
    const res = await call("/Volumes/workspace/meddesert/images\\evil.jpg");
    expect(res.status).toBe(400);
  });

  it("rejects double-encoded characters (literal % after one decode) (400)", async () => {
    const res = await call("/Volumes/workspace/meddesert/images/%2e%2e/x.jpg");
    expect(res.status).toBe(400);
  });

  it("rejects a non-JPEG extension (400)", async () => {
    const res = await call("/Volumes/workspace/meddesert/images/config.json");
    expect(res.status).toBe(400);
  });

  it("accepts a valid JPEG under the root (passes validation, not 400)", async () => {
    // No Databricks env in the test runner, so a valid path falls through to the 503
    // "not configured" branch — proving it cleared validation rather than being rejected.
    const res = await call("/Volumes/workspace/meddesert/images/bihar/aiims_patna_0.jpg");
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(503);
  });
});
