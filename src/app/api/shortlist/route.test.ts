import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lakebase", () => ({
  saveShortlistItem: vi.fn(),
  listShortlist: vi.fn(),
  deleteShortlistItem: vi.fn(),
}));
import { saveShortlistItem, listShortlist, deleteShortlistItem } from "@/lib/lakebase";
import { GET, POST, DELETE } from "./route";

const mkReq = (body: unknown) => new Request("http://x/api/shortlist", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(saveShortlistItem).mockReset();
  vi.mocked(listShortlist).mockReset();
  vi.mocked(deleteShortlistItem).mockReset();
});

describe("POST /api/shortlist", () => {
  it("rejects an invalid capability (400), Lakebase untouched", async () => {
    const res = await POST(mkReq({ facilityName: "H", capability: "xray", state: "Bihar" }));
    expect(res.status).toBe(400);
    expect(saveShortlistItem).not.toHaveBeenCalled();
  });

  it("persists a valid item (201) with normalized capability", async () => {
    vi.mocked(saveShortlistItem).mockResolvedValue({ id: "1", createdAt: "t", facilityName: "H", capability: "icu", state: "Bihar", trust: "strong", citation: "" });
    const res = await POST(mkReq({ facilityName: "H", capability: "ICU", state: "Bihar", trust: "strong" }));
    expect(res.status).toBe(201);
    expect(vi.mocked(saveShortlistItem).mock.calls[0][0]).toMatchObject({ capability: "icu" });
  });
});

describe("GET /api/shortlist", () => {
  it("lists items", async () => {
    vi.mocked(listShortlist).mockResolvedValue([{ id: "1", createdAt: "t", facilityName: "H", capability: "icu", state: "Bihar", trust: "weak", citation: "" }]);
    const j = await (await GET()).json();
    expect(j.ok).toBe(true);
    expect(j.count).toBe(1);
  });
});

describe("DELETE /api/shortlist", () => {
  it("rejects a non-numeric id (400)", async () => {
    const res = await DELETE(new Request("http://x/api/shortlist?id=abc", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(deleteShortlistItem).not.toHaveBeenCalled();
  });
  it("404 when nothing deleted", async () => {
    vi.mocked(deleteShortlistItem).mockResolvedValue(false);
    const res = await DELETE(new Request("http://x/api/shortlist?id=9", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });
});
