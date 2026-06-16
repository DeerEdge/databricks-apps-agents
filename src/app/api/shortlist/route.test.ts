import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lakebase", () => ({
  saveShortlistItem: vi.fn(),
  listShortlist: vi.fn(),
  deleteShortlistItem: vi.fn(),
}));
import { saveShortlistItem, listShortlist, deleteShortlistItem } from "@/lib/lakebase";
import { GET, POST, DELETE } from "./route";

const mkReq = (body: unknown) => new Request("http://x/api/shortlist", { method: "POST", body: JSON.stringify(body) });

const validBody = {
  facilityId: "123",
  name: "Test Hospital",
  city: "Jaipur",
  state: "Rajasthan",
  lat: 26.9,
  lon: 75.8,
  distanceKm: 12.3,
  trust: "strong",
  citation: "Has 200-bed dialysis unit",
  queryContext: "dialysis near Jaipur",
  note: "",
};

beforeEach(() => {
  vi.mocked(saveShortlistItem).mockReset();
  vi.mocked(listShortlist).mockReset();
  vi.mocked(deleteShortlistItem).mockReset();
});

describe("POST /api/shortlist", () => {
  it("rejects missing facilityId (400) without touching Lakebase", async () => {
    const res = await POST(mkReq({ ...validBody, facilityId: "" }));
    expect(res.status).toBe(400);
    expect(saveShortlistItem).not.toHaveBeenCalled();
  });

  it("rejects invalid trust (400)", async () => {
    const res = await POST(mkReq({ ...validBody, trust: "none" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid lat/lon (400)", async () => {
    const res = await POST(mkReq({ ...validBody, lat: "abc" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON (400)", async () => {
    const res = await POST(new Request("http://x/api/shortlist", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("persists a valid shortlist item (201)", async () => {
    vi.mocked(saveShortlistItem).mockResolvedValue({ id: "1", createdAt: "t", ...validBody });
    const res = await POST(mkReq(validBody));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.item.name).toBe("Test Hospital");
  });
});

describe("GET /api/shortlist", () => {
  it("lists shortlist items", async () => {
    vi.mocked(listShortlist).mockResolvedValue([{ id: "1", createdAt: "t", ...validBody }]);
    const res = await GET();
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.count).toBe(1);
  });

  it("returns 500 when Lakebase fails", async () => {
    vi.mocked(listShortlist).mockRejectedValue(new Error("offline"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/shortlist", () => {
  it("rejects a non-numeric id (400)", async () => {
    const res = await DELETE(new Request("http://x/api/shortlist?id=abc", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(deleteShortlistItem).not.toHaveBeenCalled();
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(deleteShortlistItem).mockResolvedValue(false);
    const res = await DELETE(new Request("http://x/api/shortlist?id=99", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });

  it("returns 200 on successful delete", async () => {
    vi.mocked(deleteShortlistItem).mockResolvedValue(true);
    const res = await DELETE(new Request("http://x/api/shortlist?id=1", { method: "DELETE" }));
    expect(res.status).toBe(200);
  });
});
