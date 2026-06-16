# Track 3: Referral Copilot ("Maya") — Codex Agent Specs

> This document contains detailed, self-contained specs for building Track 3.
> Each section is a standalone task that can be handed to a Codex agent independently.
> Build them in this order: **Foundation first**, then Tasks 1-3 can run in parallel.

---

## Shared Context (include this preamble with EVERY agent task)

### Project overview
Medical Desert Planner — a Next.js app deployed as a Databricks App (Free Edition).
Currently implements Track 2 (regional care-gap mapping). We're adding Track 3: a
**Referral Copilot** on a new `/referral` page. The copilot is an AI agent named
**Maya** that takes natural language care needs (e.g., "dialysis near Jaipur") and
returns ranked facility recommendations with cited evidence.

### Tech stack
- Next.js 14+ App Router (all code in `src/`)
- TypeScript strict
- Databricks SQL Statement API via `src/lib/databricks.ts` (`runSql()`)
- Lakebase (Postgres) via `src/lib/lakebase.ts` (connection pooling, auto-schema)
- Mosaic AI Model Serving (chat completions with tool-calling)
- MapLibre GL for maps
- Vitest for testing
- CSS: custom design system in `src/app/globals.css` (CSS variables, BEM-like classes)

### Key files to reference
- `src/lib/databricks.ts` — `runSql(statement, params)` for all SQL queries
- `src/lib/lakebase.ts` — Lakebase connection pool, `ensureSchema()` pattern
- `src/lib/meddesert.ts` — shared pure helpers (`CAPABILITIES`, `normalizeState`, `trustClass`, `trustColor`, `trustLabel`)
- `src/lib/scenario.ts` — validation pattern (`Validated` type, `validateScenario()`)
- `src/app/api/scenarios/route.ts` — reference for API route structure (GET/POST/DELETE)
- `src/components/AgentAsk.tsx` — reference for chat UI patterns
- `src/components/GapMap.tsx` — reference for MapLibre usage
- `src/app/globals.css` — design system (use existing CSS variables)
- `vitest.config.ts` — test config with `@/` alias

### Critical rules (from CLAUDE.md)
- NEVER string-concatenate user input into SQL — use `:name` params with `runSql()`
- NEVER put DATABRICKS_TOKEN client-side
- All API errors return `{ ok: false, error: string }` with appropriate status codes
- Validate/sanitize every input at the boundary
- No `SELECT *` — select only needed columns
- Match existing code style exactly (naming, structure, comment density)

### Data model for Track 3
The dataset has ~10,000 Indian healthcare facilities in Databricks:

**`workspace.meddesert.facility_base`** — one row per facility:
- `unique_id` (bigint), `name`, `city`, `state` (dirty!), `postcode`
- `latitude` (double), `longitude` (double)
- `specialties` (string — structured codes, pipe-separated)
- `capability` (string — JSON array of capability claims)
- `procedure` (string — free-text procedures)
- `equipment` (string — free-text equipment)
- `description` (string — free-text)

**`workspace.meddesert.facility_capability`** — one row per facility × capability (6 caps):
- `facility_id` (bigint), `name`, `state`, `city`, `postcode`
- `latitude`, `longitude`
- `capability` (one of: icu, maternity, emergency, oncology, trauma, nicu)
- `trust` (strong / partial / weak / none)
- `citation` (string — the facility's own text backing the claim)
- `structured` (boolean), `claim` (boolean)

**Trust model:**
- `strong` = structured specialty code AND (claim OR text) — corroborated (weight 1.0)
- `partial` = structured XOR claim — one solid source (weight 0.6)
- `weak` = text only — unverified (weight 0.2)
- `none` = no mention — excluded

---

## TASK 0: Foundation Layer — COMPLETED

> This task is DONE. Files already exist at `src/lib/referral.ts` and `src/lib/referral.test.ts`.
> 29 tests pass. Do NOT recreate or modify these files — import from them.

### Objective
Create the pure logic library and types that all other pieces depend on.

### File: `src/lib/referral.ts`

```typescript
// Pure logic for the referral copilot. No DB / DOM → fully testable.
// Haversine distance, candidate ranking, input validation, types.

// ---------- TYPES ----------

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
  matchingEvidence: string[];   // text snippets showing why this facility matches
  missingEvidence: string[];    // what's absent or suspicious
  explanation: string;          // Maya's narrative for why this is recommended
}

export interface ReferralResult {
  query: string;
  resolvedNeed: string;        // what Maya interpreted the care need as
  resolvedLocation: string;    // what location was resolved
  locationLat: number;
  locationLon: number;
  radiusKm: number;
  candidates: ReferralCandidate[];
  reasoningSteps: string[];
  answer: string;              // Maya's conversational response text
}

export interface ShortlistItem {
  facilityId: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  distanceKm: number;
  trust: string;
  citation: string;
  queryContext: string;        // what the user asked when this was saved
  note: string;               // optional user note
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
  lat1: number, lon1: number,
  lat2: number, lon2: number
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
const DISTANCE_DECAY = 50; // km

/** Rank score: trust-weighted relevance with distance decay.
 *  Higher = better candidate. Strong+close wins. */
export function rankScore(trust: string, distanceKm: number): number {
  const tw = TRUST_WEIGHTS[trust] ?? 0.1;
  return tw / (1 + distanceKm / DISTANCE_DECAY);
}

/** Sort candidates by rank score descending (best first). */
export function rankCandidates(candidates: ReferralCandidate[]): ReferralCandidate[] {
  return [...candidates].sort(
    (a, b) => rankScore(b.trust, b.distanceKm) - rankScore(a.trust, a.distanceKm)
  );
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
```

### File: `src/lib/referral.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { haversineKm, rankScore, rankCandidates, validateShortlistInput } from "./referral";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(26.9, 75.8, 26.9, 75.8)).toBe(0);
  });

  it("calculates ~2,200 km from Delhi to Chennai", () => {
    const d = haversineKm(28.6139, 77.209, 13.0827, 80.2707);
    expect(d).toBeGreaterThan(1700);
    expect(d).toBeLessThan(1800);
  });

  it("calculates short distance (~12 km) correctly", () => {
    // Jaipur center to Jaipur outskirts
    const d = haversineKm(26.9124, 75.7873, 26.82, 75.80);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(15);
  });
});

describe("rankScore", () => {
  it("strong + close ranks highest", () => {
    expect(rankScore("strong", 5)).toBeGreaterThan(rankScore("partial", 5));
    expect(rankScore("strong", 5)).toBeGreaterThan(rankScore("strong", 50));
  });

  it("strong far beats weak close", () => {
    expect(rankScore("strong", 30)).toBeGreaterThan(rankScore("weak", 5));
  });

  it("distance decay: 50km halves the score", () => {
    const at0 = rankScore("strong", 0);
    const at50 = rankScore("strong", 50);
    expect(at50).toBeCloseTo(at0 / 2, 2);
  });
});

describe("rankCandidates", () => {
  it("sorts by rank score descending", () => {
    const candidates = [
      { trust: "weak", distanceKm: 5 },
      { trust: "strong", distanceKm: 20 },
      { trust: "partial", distanceKm: 10 },
    ] as any[];
    const sorted = rankCandidates(candidates);
    expect(sorted[0].trust).toBe("strong");
    expect(sorted[2].trust).toBe("weak");
  });
});

describe("validateShortlistInput", () => {
  const valid = {
    facilityId: "123", name: "Test Hospital", city: "Jaipur",
    state: "Rajasthan", lat: 26.9, lon: 75.8, distanceKm: 12.3,
    trust: "strong", citation: "Has dialysis unit", queryContext: "dialysis near Jaipur", note: "",
  };

  it("accepts valid input", () => {
    const r = validateShortlistInput(valid);
    expect(r.ok).toBe(true);
  });

  it("rejects missing facilityId", () => {
    const r = validateShortlistInput({ ...valid, facilityId: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid trust", () => {
    const r = validateShortlistInput({ ...valid, trust: "none" });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid lat/lon", () => {
    const r = validateShortlistInput({ ...valid, lat: "abc" });
    expect(r.ok).toBe(false);
  });

  it("clamps long strings", () => {
    const r = validateShortlistInput({ ...valid, note: "x".repeat(2000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note.length).toBeLessThanOrEqual(1000);
  });
});
```

---

## TASK 1: API Routes (`/api/referral` + `/api/shortlist`) — COMPLETED

> Completed 2026-06-16. Files added/updated:
> `src/app/api/referral/route.ts`, `src/app/api/referral/route.test.ts`,
> `src/app/api/shortlist/route.ts`, `src/app/api/shortlist/route.test.ts`,
> and `src/lib/lakebase.ts` shortlist persistence helpers.
> Verification: 103 tests pass (`npm test`); production build clean (`npm run build`).

### Objective
Create the backend endpoints that power Maya. Two routes:
1. `/api/referral` — POST: takes the user's question, calls Mosaic AI with tools, returns ranked candidates
2. `/api/shortlist` — GET/POST/DELETE: persist/list/remove shortlisted facilities

### Prerequisites
- `src/lib/referral.ts` must exist (Task 0)
- `src/lib/lakebase.ts` exists (add shortlist functions to it)
- `src/lib/databricks.ts` exists (use `runSql()`)

---

### File: `src/app/api/referral/route.ts`

```typescript
import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";
import { rankCandidates, type ReferralCandidate } from "@/lib/referral";

export const dynamic = "force-dynamic";

const MOSAIC_ENDPOINT = process.env.MOSAIC_AI_ENDPOINT; // e.g. https://<workspace>/serving-endpoints/<name>/invocations
const DBX_TOKEN = process.env.DATABRICKS_TOKEN;

const MAYA_SYSTEM_PROMPT = `You are Maya, a healthcare referral copilot for India. Your role: help planners, coordinators, and patients find the right facility for a specific care need based on location and evidence quality.

VOICE: Formal, simple, concise. Don't pad responses with filler. When presenting recommendations, be thorough — cite evidence, explain distance, flag gaps — but use plain language a non-technical planner can act on.

DATA CONTEXT: You search ~10,000 Indian healthcare facilities. Their data contains CLAIMS, not verified facts. Evidence quality is tiered:
- Strong: corroborated by structured specialty codes + description/procedures
- Partial: one solid source (specialty code OR procedure listing, not both)
- Weak: mentioned only in free-text description — treat as unverified

WHEN RECOMMENDING:
1. Always cite the facility's own text as evidence for the match
2. State the distance clearly in kilometers
3. Flag what's MISSING — if expected procedures, equipment, or specialties aren't mentioned, say so explicitly
4. Never present weak-evidence facilities as confident recommendations — qualify them
5. If nothing strong exists nearby, say that honestly

WHEN NO RESULTS: Don't fabricate. Say "I found no facilities with strong evidence for [need] within [radius] of [location]" and suggest broadening the search.

You have access to tools to search facilities. Use them. Return your answer as JSON with this structure:
{
  "answer": "your conversational response",
  "reasoning_steps": ["step 1", "step 2", ...],
  "resolved_need": "what you interpreted the need as",
  "resolved_location": "city/area resolved",
  "candidates": [{ ... }]
}`;

// Tool definitions for Mosaic AI function-calling
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_facilities_by_capability",
      description: "Search facilities that have a known capability (icu, maternity, emergency, oncology, trauma, nicu) near a location. Returns up to 10 facilities ranked by trust then distance.",
      parameters: {
        type: "object",
        properties: {
          capability: { type: "string", enum: ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"] },
          lat: { type: "number", description: "Latitude of the search center" },
          lon: { type: "number", description: "Longitude of the search center" },
          radius_km: { type: "number", description: "Search radius in km (default 50)" },
        },
        required: ["capability", "lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_facilities_by_keyword",
      description: "Search facilities by a free-text keyword (e.g. 'dialysis', 'cardiac surgery', 'MRI') in their description, procedure, equipment, and specialty fields. Use when the need is NOT one of the 6 fixed capabilities. Returns up to 10 facilities ranked by evidence quality then distance.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "The care need keyword to search for" },
          lat: { type: "number", description: "Latitude of the search center" },
          lon: { type: "number", description: "Longitude of the search center" },
          radius_km: { type: "number", description: "Search radius in km (default 50)" },
        },
        required: ["keyword", "lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_location_coords",
      description: "Resolve a city or district name to approximate lat/lon coordinates by finding the centroid of known facilities in that area.",
      parameters: {
        type: "object",
        properties: {
          place_name: { type: "string", description: "City or district name (e.g. 'Jaipur', 'Patna', 'rural Bihar')" },
        },
        required: ["place_name"],
      },
    },
  },
];

// --- Tool execution ---

async function execSearchByCapability(args: { capability: string; lat: number; lon: number; radius_km?: number }) {
  const radius = args.radius_km ?? 50;
  const { rows } = await runSql(
    `SELECT fc.facility_id, fb.name, fb.city, fb.latitude, fb.longitude,
            fc.trust, fc.citation,
            (6371 * acos(
              LEAST(1.0, cos(radians(:lat)) * cos(radians(fb.latitude))
              * cos(radians(fb.longitude) - radians(:lon))
              + sin(radians(:lat)) * sin(radians(fb.latitude)))
            )) AS distance_km
     FROM workspace.meddesert.facility_base fb
     JOIN workspace.meddesert.facility_capability fc ON fb.unique_id = fc.facility_id
     WHERE fc.capability = :cap AND fc.trust <> 'none'
       AND fb.latitude IS NOT NULL AND fb.longitude IS NOT NULL
     HAVING distance_km < :radius
     ORDER BY CASE fc.trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END, distance_km
     LIMIT 10`,
    [
      { name: "cap", value: args.capability, type: "STRING" },
      { name: "lat", value: args.lat, type: "DOUBLE" },
      { name: "lon", value: args.lon, type: "DOUBLE" },
      { name: "radius", value: radius, type: "DOUBLE" },
    ]
  );
  return rows.map((r) => ({
    facilityId: String(r.facility_id ?? ""),
    name: String(r.name ?? ""),
    city: String(r.city ?? ""),
    lat: Number(r.latitude),
    lon: Number(r.longitude),
    trust: String(r.trust ?? "weak"),
    citation: String(r.citation ?? "").trim(),
    distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
  }));
}

async function execSearchByKeyword(args: { keyword: string; lat: number; lon: number; radius_km?: number }) {
  const radius = args.radius_km ?? 50;
  const kw = `%${args.keyword.toLowerCase().replace(/[%_]/g, "")}%`;
  const { rows } = await runSql(
    `SELECT fb.unique_id, fb.name, fb.city, fb.latitude, fb.longitude,
            fb.specialties, fb.description, fb.procedure, fb.equipment,
            CASE
              WHEN lower(coalesce(fb.specialties,'')) LIKE :kw THEN 'strong'
              WHEN lower(coalesce(fb.capability,'')) LIKE :kw THEN 'partial'
              WHEN lower(coalesce(fb.procedure,'')) LIKE :kw
                OR lower(coalesce(fb.equipment,'')) LIKE :kw THEN 'partial'
              WHEN lower(coalesce(fb.description,'')) LIKE :kw THEN 'weak'
            END AS computed_trust,
            coalesce(
              nullif(regexp_extract(coalesce(fb.procedure,''), concat('(?i)([^.]*', :kw_raw, '[^.]*)'), 1), ''),
              nullif(regexp_extract(coalesce(fb.description,''), concat('(?i)([^.]*', :kw_raw, '[^.]*)'), 1), '')
            ) AS citation,
            (6371 * acos(
              LEAST(1.0, cos(radians(:lat)) * cos(radians(fb.latitude))
              * cos(radians(fb.longitude) - radians(:lon))
              + sin(radians(:lat)) * sin(radians(fb.latitude)))
            )) AS distance_km
     FROM workspace.meddesert.facility_base fb
     WHERE lower(concat_ws(' ', coalesce(fb.description,''), coalesce(fb.procedure,''),
                 coalesce(fb.equipment,''), coalesce(fb.specialties,''))) LIKE :kw
       AND fb.latitude IS NOT NULL AND fb.longitude IS NOT NULL
     HAVING distance_km < :radius
     ORDER BY CASE computed_trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END, distance_km
     LIMIT 10`,
    [
      { name: "kw", value: kw, type: "STRING" },
      { name: "kw_raw", value: args.keyword.toLowerCase(), type: "STRING" },
      { name: "lat", value: args.lat, type: "DOUBLE" },
      { name: "lon", value: args.lon, type: "DOUBLE" },
      { name: "radius", value: radius, type: "DOUBLE" },
    ]
  );
  return rows.map((r) => ({
    facilityId: String(r.unique_id ?? ""),
    name: String(r.name ?? ""),
    city: String(r.city ?? ""),
    lat: Number(r.latitude),
    lon: Number(r.longitude),
    trust: String(r.computed_trust ?? "weak"),
    citation: String(r.citation ?? "").trim(),
    distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
  }));
}

async function execGetLocationCoords(args: { place_name: string }) {
  const place = `%${args.place_name.toLowerCase().replace(/[%_]/g, "")}%`;
  const { rows } = await runSql(
    `SELECT round(avg(latitude), 4) AS lat, round(avg(longitude), 4) AS lon, count(*) AS n
     FROM workspace.meddesert.facility_base
     WHERE (lower(city) LIKE :place OR lower(state) LIKE :place)
       AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    [{ name: "place", value: place, type: "STRING" }]
  );
  if (!rows.length || !rows[0].lat) return { lat: null, lon: null, found: false };
  return { lat: Number(rows[0].lat), lon: Number(rows[0].lon), found: true, facilitiesInArea: Number(rows[0].n) };
}

// --- Main route handler ---

export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });

  if (!MOSAIC_ENDPOINT || !DBX_TOKEN) {
    return NextResponse.json({ ok: false, error: "Mosaic AI endpoint not configured" }, { status: 500 });
  }

  try {
    const t0 = Date.now();

    // Call Mosaic AI with tool definitions
    let messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> = [
      { role: "system", content: MAYA_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];

    let finalResponse: string | null = null;
    const maxToolRounds = 5;

    for (let round = 0; round < maxToolRounds; round++) {
      const res = await fetch(MOSAIC_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${DBX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tools: TOOLS, tool_choice: "auto" }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Mosaic AI ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;

      if (!msg) throw new Error("No response from Mosaic AI");

      // If the model wants to call tools
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg); // include assistant msg with tool_calls

        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          const fnArgs = JSON.parse(tc.function.arguments);
          let result: unknown;

          switch (fnName) {
            case "search_facilities_by_capability":
              result = await execSearchByCapability(fnArgs);
              break;
            case "search_facilities_by_keyword":
              result = await execSearchByKeyword(fnArgs);
              break;
            case "get_location_coords":
              result = await execGetLocationCoords(fnArgs);
              break;
            default:
              result = { error: `Unknown tool: ${fnName}` };
          }

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        }
      } else {
        // Model is done — final text response
        finalResponse = msg.content;
        break;
      }
    }

    if (!finalResponse) {
      return NextResponse.json({ ok: false, error: "Maya could not produce a response" }, { status: 500 });
    }

    // Parse Maya's structured JSON response
    let parsed: { answer: string; reasoning_steps: string[]; candidates: unknown[]; resolved_need?: string; resolved_location?: string };
    try {
      parsed = JSON.parse(finalResponse);
    } catch {
      // If Maya returned plain text instead of JSON, wrap it
      parsed = { answer: finalResponse, reasoning_steps: [], candidates: [] };
    }

    return NextResponse.json({
      ok: true,
      question,
      answer: parsed.answer,
      reasoningSteps: parsed.reasoning_steps ?? [],
      resolvedNeed: parsed.resolved_need ?? "",
      resolvedLocation: parsed.resolved_location ?? "",
      candidates: parsed.candidates ?? [],
      meta: { ms: Date.now() - t0, engine: "Maya · Mosaic AI + Databricks SQL" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
```

**Important notes for the agent building this:**
- The `MOSAIC_ENDPOINT` env var format is: `https://<workspace-host>/serving-endpoints/<endpoint-name>/invocations`
- The tool-calling loop handles multiple rounds (model calls tool → we execute → model reasons → maybe calls another tool → eventually returns final answer)
- The SQL uses `HAVING` for computed column filtering (Databricks SQL supports this)
- `LEAST(1.0, ...)` in the acos prevents floating-point errors from domain violations
- Sanitize keyword LIKE input: strip `%` and `_` from user input before wrapping with `%`

---

### File: `src/app/api/shortlist/route.ts`

Follow the exact pattern of `src/app/api/scenarios/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { validateShortlistInput } from "@/lib/referral";
import { saveShortlistItem, listShortlist, deleteShortlistItem } from "@/lib/lakebase";

export const dynamic = "force-dynamic";

// GET /api/shortlist — list saved shortlist items (newest first)
export async function GET() {
  try {
    const items = await listShortlist();
    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// POST /api/shortlist — save a facility to the shortlist
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const v = validateShortlistInput(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  try {
    const item = await saveShortlistItem(v.value);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

// DELETE /api/shortlist?id=123
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "valid id required" }, { status: 400 });
  try {
    const removed = await deleteShortlistItem(id);
    return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
```

---

### Additions to `src/lib/lakebase.ts`

Add these to the existing file. Follow the exact patterns of `saveScenario`, `listScenarios`, `deleteScenario`:

1. Add `import type { CleanShortlistInput, SavedShortlistItem } from "./referral";` at the top

2. Add `saved_shortlist` table to the `ensureSchema()` function:
```sql
CREATE TABLE IF NOT EXISTS saved_shortlist (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  facility_id   text NOT NULL,
  name          text NOT NULL,
  city          text NOT NULL DEFAULT '',
  state         text NOT NULL,
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  distance_km   double precision NOT NULL,
  trust         text NOT NULL,
  citation      text NOT NULL DEFAULT '',
  query_context text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT ''
);
```

3. Add these three functions:
```typescript
export async function saveShortlistItem(s: CleanShortlistInput): Promise<SavedShortlistItem> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO saved_shortlist (facility_id, name, city, state, lat, lon, distance_km, trust, citation, query_context, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, created_at, facility_id, name, city, state, lat, lon, distance_km, trust, citation, query_context, note`,
    [s.facilityId, s.name, s.city, s.state, s.lat, s.lon, s.distanceKm, s.trust, s.citation, s.queryContext, s.note]
  );
  return toShortlistItem(rows[0]);
}

export async function listShortlist(limit = 50): Promise<SavedShortlistItem[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, created_at, facility_id, name, city, state, lat, lon, distance_km, trust, citation, query_context, note
     FROM saved_shortlist ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toShortlistItem);
}

export async function deleteShortlistItem(id: string): Promise<boolean> {
  await ensureSchema();
  const { rowCount } = await getPool().query(`DELETE FROM saved_shortlist WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

function toShortlistItem(r: any): SavedShortlistItem {
  return {
    id: String(r.id),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    facilityId: r.facility_id,
    name: r.name,
    city: r.city ?? "",
    state: r.state,
    lat: Number(r.lat),
    lon: Number(r.lon),
    distanceKm: Number(r.distance_km),
    trust: r.trust,
    citation: r.citation ?? "",
    queryContext: r.query_context ?? "",
    note: r.note ?? "",
  };
}
```

---

### Env var to add to `.env.local`:
```
MOSAIC_AI_ENDPOINT=https://<your-workspace>.cloud.databricks.com/serving-endpoints/<endpoint-name>/invocations
```

---

### Test file: `src/app/api/referral/route.test.ts`

Mock both `@/lib/databricks` and the global `fetch` (for the Mosaic AI call). Test:
- 400 on empty question
- 400 on invalid JSON
- 500 when MOSAIC_AI_ENDPOINT is missing
- Success flow: mock fetch to return a Mosaic AI response with tool_calls, then a final response
- Tool execution: verify `runSql` is called with parameterized queries (no string concat)

### Test file: `src/app/api/shortlist/route.test.ts`

Follow `src/app/api/scenarios/route.test.ts` pattern exactly:
- Mock `@/lib/lakebase` (saveShortlistItem, listShortlist, deleteShortlistItem)
- Test POST rejects invalid input (400) without touching Lakebase
- Test POST persists valid input (201)
- Test GET lists items
- Test DELETE rejects non-numeric id (400)
- Test DELETE returns 404 when nothing was deleted

---

## TASK 2: UI Components (MayaCopilot + Side Panel + Page)

### Objective
Build the frontend for the `/referral` page: a conversational chat with Maya, result cards,
and a slide-in side panel with a map.

### Prerequisites
- Task 0 done (types from `src/lib/referral.ts`)
- Task 1 done (API routes at `/api/referral` and `/api/shortlist`)

---

### File: `src/app/referral/page.tsx`

```typescript
import MayaCopilot from "@/components/MayaCopilot";

export const metadata = {
  title: "Maya — Referral Copilot",
  description: "Find the right healthcare facility for a specific care need, powered by evidence.",
};

export default function ReferralPage() {
  return <MayaCopilot />;
}
```

---

### File: `src/components/MayaCopilot.tsx`

**Key behaviors:**
- Full-width chat by default
- Chat narrows when side panel is open (side panel slides in from right)
- Side panel appears ONLY when a result card is clicked
- Side panel has [X] close button in top-right
- Clicking a different result card swaps side panel content
- Chat input at bottom, suggestion chips above it on first load
- Reasoning steps animate in one-by-one (same pattern as AgentAsk.tsx)
- Result cards show: facility name, distance (km), trust badge, one-line citation snippet
- Side panel shows: zoomed MapLibre map with pin + "WHY RECOMMENDED" section + "MISSING/UNCERTAIN" section + "Save to Shortlist" button

**Reference the existing patterns in:**
- `src/components/AgentAsk.tsx` — for the chat/reasoning animation pattern
- `src/components/GapMap.tsx` — for MapLibre initialization

**Component structure:**
```
MayaCopilot (client component)
├── Chat area (message list + input)
│   ├── Maya greeting message
│   ├── User messages
│   ├── Maya responses with:
│   │   ├── Reasoning steps (animated)
│   │   ├── Answer text
│   │   └── Result cards (clickable)
│   ├── Suggestion chips (shown initially)
│   └── Input bar + send button
└── Side panel (conditionally rendered)
    ├── Close [X] button
    ├── Mini MapLibre map (zoomed to facility pin)
    ├── Facility name + distance
    ├── "WHY RECOMMENDED" section (trust badge + cited text)
    ├── "MISSING / UNCERTAIN" section (flags)
    └── "Save to Shortlist" button
```

**State:**
```typescript
const [messages, setMessages] = useState<Message[]>([]);     // conversation history
const [input, setInput] = useState("");                       // current input text
const [loading, setLoading] = useState(false);                // request in flight
const [selectedCandidate, setSelectedCandidate] = useState<ReferralCandidate | null>(null); // side panel
const [shortlist, setShortlist] = useState<SavedShortlistItem[]>([]); // fetched on mount
```

**Message type:**
```typescript
interface Message {
  role: "user" | "maya";
  content: string;                     // text content
  reasoningSteps?: string[];           // for maya messages
  candidates?: ReferralCandidate[];    // for maya messages with results
  timestamp: number;
}
```

**CSS classes to use** (from globals.css design system):
- `.panel`, `.panel__head`, `.panel__title`, `.panel__body` — card containers
- `.trust`, `.trust--strong`, `.trust--partial`, `.trust--weak` — trust badges
- `.ask__input`, `.ask__send`, `.ask__chip` — input + buttons (adapt class names for referral)
- `.ask__steps`, `.ask__step` — reasoning animation
- `.obs` — observability strip (meta info)
- Use the same CSS variables: `--paper`, `--ink`, `--accent`, `--radius`, `--shadow`, etc.

**Add new CSS to `src/app/globals.css`** for the referral page (prefix classes with `ref__`):
- `.ref__layout` — flex container, full viewport height
- `.ref__chat` — left chat area (flex: 1 when panel closed, flex: 0.6 when panel open)
- `.ref__panel` — right side panel (width: 420px, slides in with CSS transition)
- `.ref__panel--open` — visible state
- `.ref__card` — result card (clickable, shows hover state)
- `.ref__card--active` — currently selected card (highlighted)
- `.ref__close` — close button in side panel
- `.ref__map` — mini map container (height: 200px)
- `.ref__why` — "why recommended" section
- `.ref__missing` — "missing/uncertain" section
- `.ref__save` — save to shortlist button

**Suggestion chips for initial state:**
```typescript
const SUGGESTIONS = [
  "Dialysis near Jaipur",
  "Emergency surgery near Patna",
  "NICU in Kerala",
  "Oncology near Mumbai",
  "Trauma center near Lucknow",
];
```

**MapLibre mini-map in side panel:**
- Use same CARTO basemap: `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`
- Initialize with `useRef` (same pattern as GapMap.tsx)
- Center on the selected facility's lat/lon
- Zoom level ~12 (city-level)
- Place a single marker/pin on the facility
- No interactivity needed (static zoom view)
- Reinitialize/update when selectedCandidate changes

**API call pattern:**
```typescript
async function askMaya(question: string) {
  setLoading(true);
  const res = await fetch("/api/referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error);
  // Add maya message with reasoning + candidates
  setMessages(prev => [...prev, {
    role: "maya",
    content: j.answer,
    reasoningSteps: j.reasoningSteps,
    candidates: j.candidates,
    timestamp: Date.now(),
  }]);
}
```

---

### File: `src/app/layout.tsx` (MODIFY — add navigation)

Add a top navigation bar to the existing layout. Current layout just renders `{children}` in a `<body>`. Add a `<nav>` above the children:

```tsx
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <nav className="app-nav">
          <a href="/" className="app-nav__link">Medical Desert Planner</a>
          <a href="/referral" className="app-nav__link">Referral Copilot</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
```

Add CSS for `.app-nav`:
```css
.app-nav {
  display: flex;
  gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--hair);
  background: var(--paper);
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
}
.app-nav__link {
  color: var(--ink-2);
  text-decoration: none;
  padding: 0.25rem 0;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.app-nav__link:hover,
.app-nav__link[aria-current="page"] {
  color: var(--ink);
  border-bottom-color: var(--accent);
}
```

**IMPORTANT:** Do NOT break the existing Track 2 page. The nav must be minimal and not interfere with the current full-height map layout. If the existing `.app` class uses `height: 100vh`, adjust to account for the nav height (e.g., `height: calc(100vh - nav-height)`).

---

## TASK 3: Tests (Route + Integration)

### Objective
Write comprehensive tests for the `/api/referral` and `/api/shortlist` routes.

### Prerequisites
- Task 0 done (referral.ts + referral.test.ts already cover lib layer)
- Task 1 done (routes exist)

---

### File: `src/app/api/referral/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock databricks
vi.mock("@/lib/databricks", () => ({
  runSql: vi.fn(),
}));
import { runSql } from "@/lib/databricks";

// Mock global fetch (for Mosaic AI calls)
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Set env vars before importing route
process.env.MOSAIC_AI_ENDPOINT = "https://test.cloud.databricks.com/serving-endpoints/maya/invocations";
process.env.DATABRICKS_TOKEN = "test-token";
process.env.DATABRICKS_HOST = "https://test.cloud.databricks.com";
process.env.DATABRICKS_WAREHOUSE_ID = "abc123";

import { POST } from "./route";

const mkReq = (body: unknown) =>
  new Request("http://x/api/referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(runSql).mockReset();
  mockFetch.mockReset();
});

describe("POST /api/referral", () => {
  it("rejects empty question (400)", async () => {
    const res = await POST(mkReq({ question: "" }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toContain("question required");
  });

  it("rejects invalid JSON (400)", async () => {
    const res = await POST(new Request("http://x/api/referral", {
      method: "POST",
      body: "not json",
    }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when Mosaic AI fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service unavailable",
    });
    const res = await POST(mkReq({ question: "dialysis near Jaipur" }));
    expect(res.status).toBe(500);
  });

  it("success: calls Mosaic AI and returns structured response", async () => {
    // Mock Mosaic AI returning a tool call, then a final response
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                id: "tc1",
                function: {
                  name: "get_location_coords",
                  arguments: JSON.stringify({ place_name: "Jaipur" }),
                },
              }],
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                answer: "I found 3 facilities with dialysis near Jaipur.",
                reasoning_steps: ["Resolved Jaipur to coordinates", "Searched for dialysis"],
                resolved_need: "dialysis",
                resolved_location: "Jaipur",
                candidates: [],
              }),
            },
          }],
        }),
      });

    // Mock runSql for get_location_coords
    vi.mocked(runSql).mockResolvedValueOnce({
      columns: ["lat", "lon", "n"],
      rows: [{ lat: 26.9, lon: 75.8, n: 42 }],
    });

    const res = await POST(mkReq({ question: "dialysis near Jaipur" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.answer).toContain("dialysis");
    expect(j.reasoningSteps).toHaveLength(2);
  });

  it("does not string-concatenate user input into SQL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            tool_calls: [{
              id: "tc1",
              function: {
                name: "search_facilities_by_keyword",
                arguments: JSON.stringify({ keyword: "dialysis'; DROP TABLE--", lat: 26.9, lon: 75.8 }),
              },
            }],
          },
        }],
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ answer: "no results", reasoning_steps: [], candidates: [] }) } }],
      }),
    });

    vi.mocked(runSql).mockResolvedValueOnce({ columns: [], rows: [] });

    await POST(mkReq({ question: "test" }));

    // Verify runSql was called with params, not string concatenation
    const call = vi.mocked(runSql).mock.calls[0];
    expect(call[0]).toContain(":kw"); // parameterized
    expect(call[0]).not.toContain("DROP TABLE"); // not in the statement string
  });
});
```

---

### File: `src/app/api/shortlist/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lakebase", () => ({
  saveShortlistItem: vi.fn(),
  listShortlist: vi.fn(),
  deleteShortlistItem: vi.fn(),
}));
import { saveShortlistItem, listShortlist, deleteShortlistItem } from "@/lib/lakebase";
import { GET, POST, DELETE } from "./route";

const mkReq = (body: unknown) => new Request("http://x/api/shortlist", {
  method: "POST",
  body: JSON.stringify(body),
});

const validBody = {
  facilityId: "123",
  name: "Test Hospital",
  city: "Jaipur",
  state: "Rajasthan",
  lat: 26.9,
  lon: 75.8,
  distanceKm: 12.3,
  trust: "strong",
  citation: "Has 200-bed dialysis unit",
  queryContext: "dialysis near Jaipur",
  note: "",
};

beforeEach(() => {
  vi.mocked(saveShortlistItem).mockReset();
  vi.mocked(listShortlist).mockReset();
  vi.mocked(deleteShortlistItem).mockReset();
});

describe("POST /api/shortlist", () => {
  it("rejects missing facilityId (400) without touching Lakebase", async () => {
    const res = await POST(mkReq({ ...validBody, facilityId: "" }));
    expect(res.status).toBe(400);
    expect(saveShortlistItem).not.toHaveBeenCalled();
  });

  it("rejects invalid trust (400)", async () => {
    const res = await POST(mkReq({ ...validBody, trust: "none" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid lat/lon (400)", async () => {
    const res = await POST(mkReq({ ...validBody, lat: "abc" }));
    expect(res.status).toBe(400);
  });

  it("persists a valid shortlist item (201)", async () => {
    vi.mocked(saveShortlistItem).mockResolvedValue({
      id: "1", createdAt: "t", ...validBody,
    });
    const res = await POST(mkReq(validBody));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.item.name).toBe("Test Hospital");
  });
});

describe("GET /api/shortlist", () => {
  it("lists shortlist items", async () => {
    vi.mocked(listShortlist).mockResolvedValue([{ id: "1", createdAt: "t", ...validBody }]);
    const res = await GET();
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.count).toBe(1);
  });
});

describe("DELETE /api/shortlist", () => {
  it("rejects a non-numeric id (400)", async () => {
    const res = await DELETE(new Request("http://x/api/shortlist?id=abc", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(deleteShortlistItem).not.toHaveBeenCalled();
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(deleteShortlistItem).mockResolvedValue(false);
    const res = await DELETE(new Request("http://x/api/shortlist?id=99", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });

  it("returns 200 on successful delete", async () => {
    vi.mocked(deleteShortlistItem).mockResolvedValue(true);
    const res = await DELETE(new Request("http://x/api/shortlist?id=1", { method: "DELETE" }));
    expect(res.status).toBe(200);
  });
});
```

---

## Execution Order Summary

```
┌─────────────────────────────────────────┐
│  TASK 0: Foundation (src/lib/referral.ts │
│  + referral.test.ts)                     │
│  ✅ ALREADY COMPLETED                    │
└────────────────┬────────────────────────-┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ TASK 1  │ │ TASK 2  │ │ TASK 3  │
│ API     │ │ UI      │ │ Tests   │
│ Routes  │ │ Comps   │ │ (route) │
└─────────┘ └─────────┘ └─────────┘
```

- **Task 0 is DONE** — `src/lib/referral.ts` and `src/lib/referral.test.ts` exist with 29 passing tests
- **Task 1 is DONE** — `/api/referral`, `/api/shortlist`, Lakebase shortlist helpers, and route tests exist; 103 tests pass
- **Task 2 can proceed** against the implemented API contracts
- **Task 3 route tests are covered for Task 1** — referral and shortlist route tests were added with the API work

---

## Definition of Done (per task)

- [ ] All files created at the exact paths specified
- [ ] Code follows existing patterns (naming, structure, error handling)
- [ ] No `SELECT *` anywhere
- [ ] All SQL uses `:name` parameters via `runSql()` — NEVER string concatenation
- [ ] No secrets in code
- [ ] TypeScript strict — no `any` except where annotated with eslint-disable
- [ ] `npm run build` passes (no type errors)
- [ ] `npm test` passes (all tests green)
- [ ] CSS uses existing design system variables (no hardcoded colors)
