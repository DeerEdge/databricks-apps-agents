import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lakebase", () => ({
  saveScenario: vi.fn(),
  listScenarios: vi.fn(),
  deleteScenario: vi.fn(),
}));
import { saveScenario, listScenarios, deleteScenario } from "@/lib/lakebase";
import { GET, POST, DELETE } from "./route";

const mkReq = (body: unknown) => new Request("http://x/api/scenarios", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(saveScenario).mockReset();
  vi.mocked(listScenarios).mockReset();
  vi.mocked(deleteScenario).mockReset();
});

describe("POST /api/scenarios", () => {
  it("rejects an invalid capability (400) without touching Lakebase", async () => {
    const res = await POST(mkReq({ capability: "dentistry", state: "Bihar" }));
    expect(res.status).toBe(400);
    expect(saveScenario).not.toHaveBeenCalled();
  });

  it("rejects a missing state (400)", async () => {
    const res = await POST(mkReq({ capability: "icu", state: "" }));
    expect(res.status).toBe(400);
  });

  it("persists a valid scenario (201) with normalized values", async () => {
    vi.mocked(saveScenario).mockResolvedValue({ id: "1", createdAt: "t", capability: "icu", state: "Bihar", gapScore: 0.2, dataPoor: false, nFacilities: 5, note: "", evidence: [] });
    const res = await POST(mkReq({ capability: "ICU", state: "Bihar", gapScore: 1.5, nFacilities: 5 }));
    expect(res.status).toBe(201);
    const arg = vi.mocked(saveScenario).mock.calls[0][0];
    expect(arg).toMatchObject({ capability: "icu", gapScore: 1 }); // clamped + lowercased
  });
});

describe("GET /api/scenarios", () => {
  it("lists scenarios", async () => {
    vi.mocked(listScenarios).mockResolvedValue([{ id: "1", createdAt: "t", capability: "icu", state: "Bihar", gapScore: 0.2, dataPoor: false, nFacilities: 5, note: "n", evidence: [] }]);
    const res = await GET();
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.count).toBe(1);
  });
});

describe("DELETE /api/scenarios", () => {
  it("rejects a non-numeric id (400)", async () => {
    const res = await DELETE(new Request("http://x/api/scenarios?id=abc", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(deleteScenario).not.toHaveBeenCalled();
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(deleteScenario).mockResolvedValue(false);
    const res = await DELETE(new Request("http://x/api/scenarios?id=99", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });
});
