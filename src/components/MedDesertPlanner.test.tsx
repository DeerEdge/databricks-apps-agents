// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// GapMap pulls in maplibre-gl (WebGL), which jsdom can't run — stub it.
vi.mock("@/components/GapMap", () => ({ default: () => <div data-testid="map" /> }));

import MedDesertPlanner from "./MedDesertPlanner";

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, regions: [], scenarios: [], facilities: [], districts: [], capabilities: [], overrides: [], meta: null }),
  })) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("MedDesertPlanner layout", () => {
  it("shows the floating vertical capability stack and no PIN search", () => {
    render(<MedDesertPlanner />);
    const capfloat = document.querySelector("nav.capfloat");
    expect(capfloat).not.toBeNull();
    expect(screen.getByRole("button", { name: "ICU" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "NICU" })).not.toBeNull();
    expect(screen.queryByLabelText("Find by PIN code")).toBeNull(); // PIN removed
  });

  it("defaults the sidebar to the Agent (chat) view", () => {
    render(<MedDesertPlanner />);
    expect(screen.getByLabelText("Ask the planner agent")).not.toBeNull();
    // Info-only content (the gap-ranking segmented control) isn't shown yet
    expect(screen.queryByRole("button", { name: /Real gaps/ })).toBeNull();
  });

  it("toggles the sidebar to Info and back to Agent", () => {
    render(<MedDesertPlanner />);
    fireEvent.click(screen.getByRole("tab", { name: "Info" }));
    expect(screen.queryByLabelText("Ask the planner agent")).toBeNull();
    expect(screen.getByRole("button", { name: /Real gaps/ })).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.getByLabelText("Ask the planner agent")).not.toBeNull();
  });

  it("marks the chosen capability active in the floating stack", () => {
    render(<MedDesertPlanner />);
    const maternity = screen.getByRole("button", { name: "Maternity" });
    fireEvent.click(maternity);
    expect(maternity.className).toContain("capfloat__btn--on");
  });
});
