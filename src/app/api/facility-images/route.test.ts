import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/databricks", () => ({
  runSql: vi.fn(),
}));

import { runSql } from "@/lib/databricks";

const mockRunSql = vi.mocked(runSql);

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/facility-images");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe("GET /api/facility-images", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when state is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok).toBe(false);
  });

  it("returns assets for a valid state", async () => {
    mockRunSql.mockResolvedValueOnce({
      columns: ["hospital_name", "city", "state", "primary_image_url", "image_available", "confidence", "gallery_count", "has_icu_image"],
      rows: [
        {
          hospital_name: "Apollo Hospital",
          city: "Patna",
          state: "Bihar",
          primary_image_url: "https://example.com/icu.jpg",
          image_available: "true",
          confidence: "0.87",
          gallery_count: "2",
          has_icu_image: "true",
        },
      ],
    });

    const res = await GET(makeRequest({ state: "Bihar" }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.assets).toHaveLength(1);
    const asset = j.assets[0];
    expect(asset.hospitalName).toBe("Apollo Hospital");
    expect(asset.primaryImageUrl).toBe("https://example.com/icu.jpg");
    expect(asset.imageAvailable).toBe(true);
    expect(asset.confidence).toBeCloseTo(0.87);
    expect(asset.hasIcuImage).toBe(true);
    expect(asset.galleryCount).toBe(2);
  });

  it("returns ok:true with empty assets when enrichment table is missing", async () => {
    mockRunSql.mockRejectedValueOnce(new Error("TABLE_OR_VIEW_NOT_FOUND: hospital_map_assets"));
    const res = await GET(makeRequest({ state: "Bihar" }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.assets).toHaveLength(0);
    expect(j.count).toBe(0);
  });

  it("returns 500 on unexpected database errors", async () => {
    mockRunSql.mockRejectedValueOnce(new Error("connection refused"));
    const res = await GET(makeRequest({ state: "Bihar" }));
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.ok).toBe(false);
  });

  it("queries with the correct SQL parameter", async () => {
    mockRunSql.mockResolvedValueOnce({ columns: [], rows: [] });
    await GET(makeRequest({ state: "Rajasthan" }));
    const [sql, params] = mockRunSql.mock.calls[0];
    expect(sql).toMatch(/hospital_map_assets/);
    expect(params).toContainEqual(expect.objectContaining({ name: "state", value: "Rajasthan" }));
  });
});
