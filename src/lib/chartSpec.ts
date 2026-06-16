// Pure logic that decides whether a tabular query result "warrants a chart" and, if so, how to
// draw it. No DB / DOM / React here — the route calls inferChartSpec on a Genie query result and
// hands the spec to the <AgentChart> component. Genie returns the data; we decide the picture.

export type ChartType = "bar" | "line";

export interface ChartSpec {
  type: ChartType;
  xKey: string; // categorical / temporal label column
  series: string[]; // numeric column(s) to plot, in order
  data: Record<string, string | number>[]; // rows keyed by column name
}

// A chart is only meaningful within a sane row window — a single row has nothing to compare,
// and dozens of bars are unreadable in a chat bubble.
const MIN_ROWS = 2;
const MAX_ROWS = 30;
const MAX_SERIES = 3;

// Label columns whose name reads as time/ordinal → a line reads better than bars.
const TEMPORAL = /\b(year|yr|month|mon|date|day|week|quarter|period|time)\b/i;

function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t !== "" && Number.isFinite(Number(t));
  }
  return false;
}

function toNumber(v: unknown): number {
  return typeof v === "number" ? v : Number(String(v).trim());
}

/**
 * Decide if a Genie query result should be charted. Returns a ChartSpec, or null when the shape
 * isn't chart-worthy (no numeric measure, no categorical label, too few/many rows).
 *
 * Heuristic: pick the first non-numeric column as the x label and every numeric column (capped)
 * as the series. A column counts as numeric only if every present value parses as a finite number.
 */
export function inferChartSpec(columns: string[], rows: Record<string, unknown>[]): ChartSpec | null {
  if (!columns.length || rows.length < MIN_ROWS || rows.length > MAX_ROWS) return null;

  const numeric: string[] = [];
  const categorical: string[] = [];
  for (const col of columns) {
    const present = rows.map((r) => r[col]).filter((v) => v != null && v !== "");
    // A temporal column (e.g. "year") anchors the x-axis even when its values are numeric.
    if (!TEMPORAL.test(col) && present.length && present.every(isNumericValue)) numeric.push(col);
    else categorical.push(col);
  }

  // Need a label to anchor the x-axis and at least one measure to plot.
  if (!categorical.length || !numeric.length) return null;

  const xKey = categorical[0];
  const series = numeric.slice(0, MAX_SERIES);
  const type: ChartType = TEMPORAL.test(xKey) ? "line" : "bar";

  const data = rows.map((r) => {
    const out: Record<string, string | number> = { [xKey]: String(r[xKey] ?? "") };
    for (const s of series) out[s] = isNumericValue(r[s]) ? toNumber(r[s]) : 0;
    return out;
  });

  return { type, xKey, series, data };
}
