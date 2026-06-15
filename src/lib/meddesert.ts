// Pure helpers for the Medical Desert Planner. No DOM → testable.

export const CAPABILITIES = [
  { key: "icu", label: "ICU" },
  { key: "maternity", label: "Maternity" },
  { key: "emergency", label: "Emergency" },
  { key: "oncology", label: "Oncology" },
  { key: "trauma", label: "Trauma" },
  { key: "nicu", label: "NICU" },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

/** Normalize a state name for joining (strip diacritics, upper, trim).
 *  e.g. "Mahārāshtra" → "MAHARASHTRA" to match NFHS/address "Maharashtra". */
export function normalizeState(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface TrustCounts { strong: number; partial: number; weak: number }

/** Trust label for a single facility×capability assessment. */
export function trustLabel(trust: string): string {
  return { strong: "Strong evidence", partial: "Partial evidence", weak: "Weak / unverified", none: "No claim" }[trust] ?? trust;
}

/** CSS modifier for a trust badge (drives color). Unknown → weak (cautious default). */
export function trustClass(trust: string): string {
  return ["strong", "partial", "weak", "none"].includes(trust) ? `trust--${trust}` : "trust--weak";
}

/** Choropleth fill for a gap score 0..1 (low gap = teal, high gap = deep red). */
export function gapColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const stops: [number, [number, number, number]][] = [
    [0, [44, 125, 160]],
    [0.15, [122, 176, 105]],
    [0.3, [233, 196, 106]],
    [0.45, [238, 137, 89]],
    [0.6, [155, 34, 38]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (s <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (s - a) / (b - a);
      const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * f));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return "rgb(155, 34, 38)";
}
