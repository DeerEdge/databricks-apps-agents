// Pure logic for the referral copilot (Track 3). No DB / DOM → fully testable.
// Haversine distance, candidate ranking, input validation, types.

// ---------- TYPES ----------

export interface FieldEvidence {
  specialties: string | null;
  procedures: string | null;
  equipment: string | null;
  description: string | null;
}

export interface ReferralCandidate {
  facilityId: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  distanceKm: number;
  trust: "strong" | "partial" | "weak";
  citation: string;
  matchingEvidence: string[];
  missingEvidence: string[];
  explanation: string;
  fieldEvidence?: FieldEvidence;
  qualitativeAnalysis?: string;
  rankReason?: string;
}

export interface ReferralResult {
  query: string;
  resolvedNeed: string;
  resolvedLocation: string;
  locationLat: number;
  locationLon: number;
  radiusKm: number;
  candidates: ReferralCandidate[];
  reasoningSteps: string[];
  answer: string;
}

export interface CleanShortlistInput {
  facilityId: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  distanceKm: number;
  trust: string;
  citation: string;
  queryContext: string;
  note: string;
}

export interface SavedShortlistItem extends CleanShortlistInput {
  id: string;
  createdAt: string;
}

export type ShortlistValidated =
  | { ok: true; value: CleanShortlistInput }
  | { ok: false; error: string };

// ---------- HAVERSINE ----------

const EARTH_RADIUS_KM = 6371;

/** Haversine distance between two lat/lon points in kilometers. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- RANKING ----------

const TRUST_WEIGHTS: Record<string, number> = {
  strong: 1.0,
  partial: 0.6,
  weak: 0.2,
};
const DISTANCE_DECAY = 50;

/** Rank score: trust-weighted relevance with distance decay.
 *  Higher = better candidate. Strong+close wins. */
export function rankScore(trust: string, distanceKm: number): number {
  const tw = TRUST_WEIGHTS[trust] ?? 0.1;
  return tw / (1 + distanceKm / DISTANCE_DECAY);
}

/** Sort candidates by rank score descending (best first). Pure — returns new array. */
export function rankCandidates(candidates: ReferralCandidate[]): ReferralCandidate[] {
  return [...candidates].sort(
    (a, b) => rankScore(b.trust, b.distanceKm) - rankScore(a.trust, a.distanceKm)
  );
}

// ---------- RANK REASONS ----------

export function computeRankReasons(candidates: ReferralCandidate[]): ReferralCandidate[] {
  if (candidates.length === 0) return candidates;

  return candidates.map((c, i) => {
    const rank = i + 1;
    const trustLabel = c.trust === "strong" ? "strong evidence" : c.trust === "partial" ? "partial evidence" : "weak evidence";

    let distanceNote = "";
    if (c.distanceKm <= 10) distanceNote = "close by";
    else if (c.distanceKm <= 30) distanceNote = `${c.distanceKm.toFixed(0)} km`;
    else distanceNote = `${c.distanceKm.toFixed(0)} km away`;

    let reason: string;
    if (rank === 1) {
      reason = `#${rank} — best match: ${trustLabel}, ${distanceNote}`;
    } else {
      const top = candidates[0];
      if (c.trust === top.trust) {
        reason = `#${rank} — ${trustLabel}, but farther (${distanceNote})`;
      } else if (c.distanceKm < top.distanceKm) {
        reason = `#${rank} — closer (${distanceNote}), but only ${trustLabel}`;
      } else {
        reason = `#${rank} — ${trustLabel}, ${distanceNote}`;
      }
    }

    return { ...c, rankReason: reason };
  });
}

// ---------- VALIDATION ----------

const NAME_MAX = 200;
const CITE_MAX = 500;
const NOTE_MAX = 1000;
const QUERY_MAX = 300;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clamp = (s: string, n: number) => s.slice(0, n).trim();

/** Validate a shortlist save request body. */
export function validateShortlistInput(body: unknown): ShortlistValidated {
  const b = (body ?? {}) as Record<string, unknown>;

  const facilityId = clamp(str(b.facilityId), 50);
  if (!facilityId) return { ok: false, error: "facilityId required" };

  const name = clamp(str(b.name), NAME_MAX);
  if (!name) return { ok: false, error: "name required" };

  const city = clamp(str(b.city), 100);
  const state = clamp(str(b.state), 80);
  if (!state) return { ok: false, error: "state required" };

  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: "valid lat/lon required" };
  }

  const distanceKm = Number(b.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return { ok: false, error: "valid distanceKm required" };
  }

  const trust = clamp(str(b.trust), 20);
  if (!["strong", "partial", "weak"].includes(trust)) {
    return { ok: false, error: "trust must be strong, partial, or weak" };
  }

  return {
    ok: true,
    value: {
      facilityId,
      name,
      city,
      state,
      lat,
      lon,
      distanceKm: Math.round(distanceKm * 10) / 10,
      trust,
      citation: clamp(str(b.citation), CITE_MAX),
      queryContext: clamp(str(b.queryContext), QUERY_MAX),
      note: clamp(str(b.note), NOTE_MAX),
    },
  };
}
