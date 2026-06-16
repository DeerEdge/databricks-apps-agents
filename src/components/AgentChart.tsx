"use client";

import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/chartSpec";
import { abbreviateLabel } from "@/lib/stateAbbr";

// Series colors: the first reuses the chatbot accent (red here), the rest fall back to the app's
// care-gap palette so multi-measure charts stay legible.
const SERIES_COLORS = ["var(--accent)", "#2c7da0", "#e9c46a"];
const color = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];
const axis = { fontSize: 10, fill: "var(--ink-3)" } as const;

// X-axis tick: Indian state/city names are long, so show an abbreviation and expose the full name
// on hover via the SVG <title> (native tooltip). Recharts clones this with x / y / payload.
function AbbrevTick(props: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const { x = 0, y = 0, payload } = props;
  const full = String(payload?.value ?? "");
  return (
    <g transform={`translate(${x},${y})`}>
      <text className="ask__tick" dy={10} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
        {abbreviateLabel(full)}
        <title>{full}</title>
      </text>
    </g>
  );
}

// Renders a chart for a Genie query result that warranted one. Returns null otherwise so the chat
// answer simply shows text.
export default function AgentChart({ spec }: { spec: ChartSpec | null }) {
  if (!spec || !spec.data.length || !spec.series.length) return null;
  const { type, xKey, series, data } = spec;

  return (
    <figure className="ask__chart" data-chart-type={type} aria-label={`${type} chart of ${series.join(", ")} by ${xKey}`}>
      <ResponsiveContainer width="100%" height={200}>
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--hair)" vertical={false} />
            <XAxis dataKey={xKey} tick={<AbbrevTick />} tickLine={false} axisLine={{ stroke: "var(--hair)" }} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={36} />
            <Tooltip cursor={{ stroke: "var(--hair-strong)" }} />
            {series.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={color(i)} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--hair)" vertical={false} />
            <XAxis dataKey={xKey} tick={<AbbrevTick />} tickLine={false} axisLine={{ stroke: "var(--hair)" }} interval={0} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={36} />
            <Tooltip cursor={{ fill: "var(--paper-sunk)" }} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={color(i)} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}
