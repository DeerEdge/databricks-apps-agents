import { describe, it, expect } from "vitest";
import { inferChartSpec } from "./chartSpec";

const rows = (...rs: Record<string, unknown>[]) => rs;

describe("inferChartSpec", () => {
  it("builds a bar chart from a categorical label + numeric measure", () => {
    const spec = inferChartSpec(
      ["state", "gap_score"],
      rows({ state: "Bihar", gap_score: 0.19 }, { state: "Meghalaya", gap_score: 0.37 })
    );
    expect(spec).toEqual({
      type: "bar",
      xKey: "state",
      series: ["gap_score"],
      data: [
        { state: "Bihar", gap_score: 0.19 },
        { state: "Meghalaya", gap_score: 0.37 },
      ],
    });
  });

  it("coerces numeric strings (Genie returns JSON_ARRAY strings)", () => {
    const spec = inferChartSpec(
      ["state", "n"],
      rows({ state: "A", n: "10" }, { state: "B", n: "20" })
    );
    expect(spec?.data).toEqual([
      { state: "A", n: 10 },
      { state: "B", n: 20 },
    ]);
  });

  it("chooses a line chart when the label column reads as temporal", () => {
    const spec = inferChartSpec(
      ["year", "births"],
      rows({ year: "2019", births: 80 }, { year: "2020", births: 84 })
    );
    expect(spec?.type).toBe("line");
    expect(spec?.xKey).toBe("year");
  });

  it("keeps multiple numeric series in column order, capped at 3", () => {
    const spec = inferChartSpec(
      ["state", "a", "b", "c", "d"],
      rows({ state: "X", a: 1, b: 2, c: 3, d: 4 }, { state: "Y", a: 5, b: 6, c: 7, d: 8 })
    );
    expect(spec?.series).toEqual(["a", "b", "c"]);
    expect(spec?.data[0]).not.toHaveProperty("d");
  });

  it("returns null when there is no numeric measure", () => {
    expect(
      inferChartSpec(["state", "note"], rows({ state: "A", note: "x" }, { state: "B", note: "y" }))
    ).toBeNull();
  });

  it("returns null when there is no categorical label (all numeric)", () => {
    expect(inferChartSpec(["a", "b"], rows({ a: 1, b: 2 }, { a: 3, b: 4 }))).toBeNull();
  });

  it("returns null for a single row (nothing to compare)", () => {
    expect(inferChartSpec(["state", "gap"], rows({ state: "A", gap: 1 }))).toBeNull();
  });

  it("returns null for an empty result", () => {
    expect(inferChartSpec([], [])).toBeNull();
    expect(inferChartSpec(["state", "gap"], [])).toBeNull();
  });

  it("returns null when there are too many rows to read", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ state: `S${i}`, gap: i }));
    expect(inferChartSpec(["state", "gap"], many)).toBeNull();
  });

  it("charts exactly at the row boundaries (2 and 30)", () => {
    const two = Array.from({ length: 2 }, (_, i) => ({ state: `S${i}`, gap: i }));
    const thirty = Array.from({ length: 30 }, (_, i) => ({ state: `S${i}`, gap: i }));
    expect(inferChartSpec(["state", "gap"], two)).not.toBeNull();
    expect(inferChartSpec(["state", "gap"], thirty)).not.toBeNull();
  });

  it("treats a column as categorical when some values are non-numeric", () => {
    // mixed column → categorical; with a clean numeric measure present it becomes the x label
    const spec = inferChartSpec(
      ["label", "val"],
      rows({ label: "10", val: 1 }, { label: "n/a", val: 2 })
    );
    expect(spec?.xKey).toBe("label");
    expect(spec?.series).toEqual(["val"]);
  });

  it("fills missing numeric cells with 0 rather than NaN", () => {
    const spec = inferChartSpec(
      ["state", "gap"],
      rows({ state: "A", gap: 5 }, { state: "B" })
    );
    expect(spec?.data[1]).toEqual({ state: "B", gap: 0 });
  });
});
