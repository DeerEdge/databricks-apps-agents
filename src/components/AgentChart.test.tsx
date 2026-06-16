// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ChartSpec } from "@/lib/chartSpec";

// ResponsiveContainer measures its parent, which is 0×0 in jsdom and would skip rendering the chart.
// Mock it to a fixed-size pass-through so the underlying SVG actually draws.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>
        <actual.ResponsiveContainer width={400} height={200}>{children}</actual.ResponsiveContainer>
      </div>
    ),
  };
});

import AgentChart from "./AgentChart";

const barSpec: ChartSpec = {
  type: "bar",
  xKey: "state",
  series: ["gap"],
  data: [{ state: "Bihar", gap: 0.19 }, { state: "Meghalaya", gap: 0.37 }],
};

afterEach(() => cleanup());

describe("AgentChart", () => {
  it("renders a bar chart figure for a bar spec", () => {
    const { container } = render(<AgentChart spec={barSpec} />);
    const fig = container.querySelector("figure.ask__chart");
    expect(fig).not.toBeNull();
    expect(fig?.getAttribute("data-chart-type")).toBe("bar");
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
  });

  it("renders a line chart for a temporal spec", () => {
    const lineSpec: ChartSpec = {
      type: "line",
      xKey: "year",
      series: ["births"],
      data: [{ year: "2019", births: 80 }, { year: "2020", births: 84 }],
    };
    const { container } = render(<AgentChart spec={lineSpec} />);
    expect(container.querySelector("figure.ask__chart")?.getAttribute("data-chart-type")).toBe("line");
  });

  it("abbreviates axis labels and keeps the full name in a hover <title>", () => {
    const { container } = render(<AgentChart spec={barSpec} />);
    const ticks = Array.from(container.querySelectorAll("text.ask__tick"));
    const meghalaya = ticks.find((t) => (t as Element).querySelector("title")?.textContent === "Meghalaya");
    expect(meghalaya).toBeDefined();
    expect((meghalaya as Element | undefined)?.textContent).toContain("ML"); // abbreviated label + title text
  });

  it("renders nothing for a null spec", () => {
    const { container } = render(<AgentChart spec={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the spec has no rows", () => {
    const { container } = render(<AgentChart spec={{ ...barSpec, data: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
