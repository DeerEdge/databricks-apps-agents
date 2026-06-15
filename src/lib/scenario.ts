// Pure logic for planning scenarios. No DB / DOM → fully testable.
// Treats all incoming fields as hostile: validates + clamps at the boundary.

import { CAPABILITIES } from "./meddesert";

const CAP_KEYS = CAPABILITIES.map((c) => c.key) as string[];

export interface EvidenceItem {
  name: string;
  trust: string;
  citation: string;
}

export interface CleanScenario {
  capability: string;
  state: string;
  gapScore: number | null;
  dataPoor: boolean;
  nFacilities: number;
  note: string;
  evidence: EvidenceItem[];
}

export type Validated =
  | { ok: true; value: CleanScenario }
  | { ok: false; error: string };

const NOTE_MAX = 1000;
const CITE_MAX = 500;
const EVIDENCE_MAX = 5;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clamp = (s: string, n: number) => s.slice(0, n).trim();

/** Top-N evidence snapshot, each field trimmed/clamped. Drops items with no citation. */
export function buildEvidenceSnapshot(items: unknown): EvidenceItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return { name: clamp(str(o.name), 200), trust: clamp(str(o.trust), 20), citation: clamp(str(o.citation), CITE_MAX) };
    })
    .filter((e) => e.citation.length > 0)
    .slice(0, EVIDENCE_MAX);
}

/** Validate + normalize a POST body into a CleanScenario, or return an error. */
export function validateScenario(body: unknown): Validated {
  const b = (body ?? {}) as Record<string, unknown>;

  const capability = str(b.capability).toLowerCase().trim();
  if (!CAP_KEYS.includes(capability)) return { ok: false, error: "invalid capability" };

  const state = clamp(str(b.state), 80);
  if (!state) return { ok: false, error: "state required" };

  let gapScore: number | null = null;
  if (b.gapScore !== null && b.gapScore !== undefined && b.gapScore !== "") {
    const n = Number(b.gapScore);
    if (!Number.isFinite(n)) return { ok: false, error: "gapScore must be a number" };
    gapScore = Math.max(0, Math.min(1, n));
  }

  const nRaw = Number(b.nFacilities ?? 0);
  const nFacilities = Number.isFinite(nRaw) ? Math.max(0, Math.round(nRaw)) : 0;

  return {
    ok: true,
    value: {
      capability,
      state,
      gapScore,
      dataPoor: b.dataPoor === true || b.dataPoor === "true",
      nFacilities,
      note: clamp(str(b.note), NOTE_MAX),
      evidence: buildEvidenceSnapshot(b.evidence),
    },
  };
}
