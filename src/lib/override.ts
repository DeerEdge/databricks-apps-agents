// Pure validation for planner trust overrides — a human correcting the AI's assessment of a
// facility×capability, with a note. Treats input as hostile (validate + clamp at the boundary).

import { CAPABILITIES } from "./meddesert";

const CAP_KEYS = CAPABILITIES.map((c) => c.key) as string[];
const TRUST_VALUES = ["strong", "partial", "weak", "none"];
const NOTE_MAX = 1000;

export interface CleanOverride {
  facilityName: string;
  capability: string;
  state: string;
  overrideTrust: string;
  note: string;
}

export type ValidatedOverride =
  | { ok: true; value: CleanOverride }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clamp = (s: string, n: number) => s.slice(0, n).trim();

export function validateOverride(body: unknown): ValidatedOverride {
  const b = (body ?? {}) as Record<string, unknown>;

  const facilityName = clamp(str(b.facilityName), 200);
  if (!facilityName) return { ok: false, error: "facilityName required" };

  const capability = str(b.capability).toLowerCase().trim();
  if (!CAP_KEYS.includes(capability)) return { ok: false, error: "invalid capability" };

  const state = clamp(str(b.state), 80);
  if (!state) return { ok: false, error: "state required" };

  const overrideTrust = str(b.overrideTrust).toLowerCase().trim();
  if (!TRUST_VALUES.includes(overrideTrust)) return { ok: false, error: "invalid overrideTrust" };

  return { ok: true, value: { facilityName, capability, state, overrideTrust, note: clamp(str(b.note), NOTE_MAX) } };
}
