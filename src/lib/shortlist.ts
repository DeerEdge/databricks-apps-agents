// Pure validation for a planner's facility shortlist — specific facilities saved to follow up
// on, across regions/capabilities. Treats input as hostile (validate + clamp at the boundary).

import { CAPABILITIES } from "./meddesert";

const CAP_KEYS = CAPABILITIES.map((c) => c.key) as string[];
const CITE_MAX = 500;

export interface CleanShortlistItem {
  facilityName: string;
  capability: string;
  state: string;
  trust: string;
  citation: string;
}

export type ValidatedShortlist =
  | { ok: true; value: CleanShortlistItem }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clamp = (s: string, n: number) => s.slice(0, n).trim();

export function validateShortlistItem(body: unknown): ValidatedShortlist {
  const b = (body ?? {}) as Record<string, unknown>;

  const facilityName = clamp(str(b.facilityName), 200);
  if (!facilityName) return { ok: false, error: "facilityName required" };

  const capability = str(b.capability).toLowerCase().trim();
  if (!CAP_KEYS.includes(capability)) return { ok: false, error: "invalid capability" };

  const state = clamp(str(b.state), 80);
  if (!state) return { ok: false, error: "state required" };

  // trust is informational on a shortlist; default to the cautious "weak" if absent/odd.
  const t = str(b.trust).toLowerCase().trim();
  const trust = ["strong", "partial", "weak", "none"].includes(t) ? t : "weak";

  return { ok: true, value: { facilityName, capability, state, trust, citation: clamp(str(b.citation), CITE_MAX) } };
}
