import { NextResponse } from "next/server";
import { runSql } from "@/lib/databricks";
import { rankCandidates, computeRankReasons, type ReferralCandidate, type FieldEvidence, type ExternalSource } from "@/lib/referral";
import { generateBatchAnalysis } from "@/lib/cerebras";

export const dynamic = "force-dynamic";

const CAPS = ["icu", "maternity", "emergency", "oncology", "trauma", "nicu"] as const;
type ToolName = "search_facilities_by_capability" | "search_facilities_by_keyword" | "get_location_coords";

interface ToolCall {
  id: string;
  function: {
    name: ToolName | string;
    arguments: string;
  };
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface MosaicMessage {
  content?: string;
  tool_calls?: ToolCall[];
}

interface MosaicResponse {
  choices?: Array<{ message?: MosaicMessage }>;
}

interface ParsedMayaResponse {
  answer?: string;
  reasoning_steps?: string[];
  resolved_need?: string;
  resolved_location?: string;
  candidates?: ReferralCandidate[];
}

const MAYA_SYSTEM_PROMPT = `You are Maya, a healthcare referral copilot for India.

VOICE: Formal, simple, concise. No filler. Short sentences.

SCOPE — you MUST enforce these boundaries:
- You ONLY help find healthcare facilities in India. Nothing else.
- If the user asks about weather, general knowledge, coding, or anything non-medical: respond with "I'm designed to help find healthcare facilities in India. Try asking about a care need and a location — for example, 'dialysis near Jaipur'." Do NOT attempt to answer.
- If a location is outside India or not found: respond with "My facility data covers India. I couldn't find that location in the dataset. Try an Indian city or state name."
- If the user asks a follow-up about a facility from your PREVIOUS search results ("Tell me more about Vaishali Hospital", "Why is AIIMS ranked higher?"): answer using the data from the prior search. Each facility has: a qualitativeAnalysis (detailed reasoning), matchingEvidence (per-field evidence list), missingEvidence (gaps), rankReason (why it ranks where it does), and a trust tier. Use ALL of this data to give a rich, conversational answer. Explain: (1) why it's recommended — which evidence sources confirmed the capability, (2) honest downsides — what evidence is missing, (3) the trust tier in plain language, (4) distance context, (5) how it compares to other results. Do NOT re-search. No tool calls needed.
- If the user asks about a specific facility that was NOT in your prior results (a cold lookup like "Tell me about AIIMS Patna" with no prior search): respond with "I search for facilities by care need and location. Try telling me what care you need near Patna, and I'll find the best-evidenced options including AIIMS if it matches."
- If the user asks about multiple care needs at once ("dialysis and oncology near Jaipur"): search for the FIRST need only, then ask "Would you also like me to search for [second need] separately?"
- If the user gives only a care need without location: ask "Which city or area in India should I search near?"
- If the user gives only a location without a care need: ask "What care need are you looking for?"
- If the input is gibberish or unclear: ask "Tell me a care need and a location — for example, 'dialysis near Jaipur'."

WORKFLOW (always follow this exact order when the query is in scope):
1. Call get_location_coords to resolve the place name to coordinates.
2. Call search_facilities_by_keyword OR search_facilities_by_capability to find matches near those coordinates.
3. Return a SHORT JSON response summarizing what you found.

You MUST call the search tools before responding with results. Never answer with facility information without searching first. For out-of-scope or incomplete queries, respond directly with the appropriate message above — no tool calls needed.

RESPONSE FORMAT (strict JSON only):
{
  "answer": "2-3 sentences max. How many found, best match, one caveat. OR a scope/clarification message.",
  "reasoning_steps": ["Resolved location to coords", "Searched for X within Y km", "Found N facilities"],
  "resolved_need": "the care need",
  "resolved_location": "city/area",
  "candidates": []
}

TOOL SELECTION:
- If the care need matches one of these 6 capabilities: icu, maternity, emergency, oncology, trauma, nicu — use search_facilities_by_capability (it uses pre-computed trust and is more reliable).
- For everything else (dialysis, cardiac surgery, MRI, physiotherapy, etc.) — use search_facilities_by_keyword.

DISTANCE CONTEXT — always describe distance in your answer:
- Within 10 km: "close by"
- 10-30 km: "reasonable travel distance"
- 30-50 km: "a significant distance"
- Beyond 50 km: mention this explicitly, e.g. "the nearest match is 65 km away"

RULES:
- "answer" must be 2-3 sentences MAX. The UI shows facility cards separately.
- Do NOT list facilities in "answer".
- "reasoning_steps" = 3-5 short lines. For clarification/scope responses, use 1 step explaining why.
- "candidates" = [] always (backend fills from tool results).
- If no results: say so, suggest broadening radius or different terms.
- Never give medical advice. You provide evidence, not prescriptions.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_facilities_by_capability",
      description: "Search facilities that have a known capability (icu, maternity, emergency, oncology, trauma, nicu) near a location. Returns up to 10 facilities ranked by trust then distance.",
      parameters: {
        type: "object",
        properties: {
          capability: { type: "string", enum: CAPS },
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
      description: "Search facilities by a free-text keyword in description, procedure, equipment, and specialty fields. Use when the need is not one of the 6 fixed capabilities.",
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
          place_name: { type: "string", description: "City or district name, e.g. Jaipur or Patna" },
        },
        required: ["place_name"],
      },
    },
  },
];

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanRadius(v: unknown): number {
  const n = finiteNumber(v);
  if (n == null || n <= 0) return 50;
  return Math.min(n, 500);
}

function stripLikeWildcards(s: string): string {
  return s.toLowerCase().replace(/[%_]/g, "").trim().slice(0, 80);
}

const SYNONYM_MAP: Record<string, string[]> = {
  kidney: ["nephrology", "dialysis", "renal"],
  nephrology: ["kidney", "dialysis", "renal"],
  dialysis: ["kidney", "nephrology", "renal"],
  renal: ["kidney", "nephrology", "dialysis"],
  heart: ["cardiac", "cardiology", "cardiovascular"],
  cardiac: ["heart", "cardiology", "cardiovascular"],
  cardiology: ["heart", "cardiac", "cardiovascular"],
  cardiovascular: ["heart", "cardiac", "cardiology"],
  baby: ["neonatal", "nicu", "pediatric"],
  infant: ["neonatal", "nicu", "pediatric"],
  neonatal: ["nicu", "pediatric", "baby"],
  pediatric: ["neonatal", "nicu", "baby"],
  cancer: ["oncology", "chemotherapy", "radiotherapy"],
  oncology: ["cancer", "chemotherapy", "radiotherapy"],
  chemotherapy: ["cancer", "oncology", "radiotherapy"],
  radiotherapy: ["cancer", "oncology", "chemotherapy"],
  brain: ["neurology", "neurosurgery"],
  neurology: ["brain", "neurosurgery"],
  neurosurgery: ["brain", "neurology"],
  bone: ["orthopedic", "orthopaedic"],
  fracture: ["orthopedic", "orthopaedic"],
  orthopedic: ["bone", "fracture", "orthopaedic"],
  orthopaedic: ["bone", "fracture", "orthopedic"],
  eye: ["ophthalmology", "ophthalmic"],
  ophthalmology: ["eye", "ophthalmic"],
  ophthalmic: ["eye", "ophthalmology"],
  ear: ["ent", "otolaryngology"],
  nose: ["ent", "otolaryngology"],
  throat: ["ent", "otolaryngology"],
  ent: ["ear", "nose", "throat", "otolaryngology"],
  otolaryngology: ["ear", "nose", "throat", "ent"],
  skin: ["dermatology"],
  dermatology: ["skin"],
  lung: ["pulmonology", "respiratory"],
  breathing: ["pulmonology", "respiratory"],
  pulmonology: ["lung", "respiratory"],
  respiratory: ["lung", "pulmonology"],
};

function getSynonyms(keyword: string): string[] {
  return SYNONYM_MAP[keyword.toLowerCase()] ?? [];
}

const SYNONYM_THRESHOLD = 3;

/** Clean raw citation text: parse JSON arrays, extract only the sentence matching the keyword, truncate. */
function cleanCitation(raw: string, keyword?: string): string {
  let text = raw.trim();
  if (!text) return "";

  // If the raw text looks like a JSON array, parse it and join
  if (text.startsWith("[") && text.includes('"')) {
    try {
      const arr = JSON.parse(text.endsWith("]") ? text : text + '"]');
      if (Array.isArray(arr)) {
        // If we have a keyword, find the most relevant item
        if (keyword) {
          const kl = keyword.toLowerCase();
          const match = arr.find((s: string) => String(s).toLowerCase().includes(kl));
          if (match) return String(match).slice(0, 200);
        }
        // Otherwise join first few items
        text = arr.slice(0, 3).join("; ");
      }
    } catch {
      // Not valid JSON — strip brackets and quotes manually
      text = text.replace(/^\["|"\]$/g, "").replace(/","/g, "; ").replace(/"/g, "");
    }
  }

  // If we have a keyword, try to extract just the relevant sentence
  if (keyword) {
    const kl = keyword.toLowerCase();
    const sentences = text.split(/[.;]/).map((s) => s.trim()).filter(Boolean);
    const match = sentences.find((s) => s.toLowerCase().includes(kl));
    if (match) return match.slice(0, 200);
  }

  return text.slice(0, 200);
}

/** Check if any term from a set appears in text. */
function matchesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

/** Get the keyword + its synonyms as an array for matching. */
function keywordTerms(keyword: string): string[] {
  const kl = keyword.toLowerCase();
  const syns = SYNONYM_MAP[kl] ?? [];
  return [kl, ...syns];
}

/** Extract an excerpt from a field that matches any of the terms. */
function extractExcerpt(fieldValue: string, terms: string[], maxLen = 200): string | null {
  if (!fieldValue.trim()) return null;

  let text = fieldValue.trim();
  // Parse JSON arrays
  if (text.startsWith("[") && text.includes('"')) {
    try {
      const arr = JSON.parse(text.endsWith("]") ? text : text + '"]');
      if (Array.isArray(arr)) {
        const matches = arr.filter((s: string) => matchesAny(String(s), terms));
        if (matches.length > 0) return matches.slice(0, 3).map(String).join("; ").slice(0, maxLen);
        return null;
      }
    } catch {
      text = text.replace(/^\["|"\]$/g, "").replace(/","/g, "; ").replace(/"/g, "");
    }
  }

  // Try to find a matching sentence or segment
  const segments = text.split(/[.;]/).map((s) => s.trim()).filter(Boolean);
  const match = segments.find((s) => matchesAny(s, terms));
  if (match) return match.slice(0, maxLen);

  // Fallback: check if the whole text matches
  if (matchesAny(text, terms)) return text.slice(0, maxLen);
  return null;
}

/** Extract structured per-field evidence. */
function extractFieldEvidence(row: Record<string, unknown>, keyword: string): FieldEvidence {
  const terms = keywordTerms(keyword);
  return {
    specialties: extractExcerpt(String(row.specialties ?? ""), terms),
    procedures: extractExcerpt(String(row.procedure ?? ""), terms),
    equipment: extractExcerpt(String(row.equipment ?? ""), terms),
    description: extractExcerpt(String(row.description ?? ""), terms),
  };
}

/** Build labeled matching evidence array from field evidence. */
function buildMatchingEvidence(evidence: FieldEvidence): string[] {
  const items: string[] = [];
  if (evidence.specialties) items.push(`Specialty: ${evidence.specialties}`);
  if (evidence.procedures) items.push(`Procedure: ${evidence.procedures}`);
  if (evidence.equipment) items.push(`Equipment: ${evidence.equipment}`);
  if (evidence.description) items.push(`Description: ${evidence.description}`);
  return items;
}

/** Compute missing evidence flags — synonym-aware. */
function computeMissingEvidence(row: Record<string, unknown>, keyword: string): string[] {
  const missing: string[] = [];
  const terms = keywordTerms(keyword);
  const specialties = String(row.specialties ?? "").toLowerCase();
  const procedure = String(row.procedure ?? "").toLowerCase();
  const equipment = String(row.equipment ?? "");

  if (!matchesAny(specialties, terms)) missing.push("Not in structured specialty codes");
  if (!matchesAny(procedure, terms)) missing.push("Not listed in procedures");
  if (!equipment.trim()) {
    missing.push("Equipment data unavailable for this facility");
  } else if (!matchesAny(equipment.toLowerCase(), terms)) {
    missing.push("No matching equipment mentioned");
  }

  return missing.slice(0, 3);
}

/** Content-specific explanation using actual field evidence. */
function computeExplanation(row: Record<string, unknown>, keyword: string, trust: string, evidence: FieldEvidence): string {
  if (trust === "strong") {
    const parts: string[] = [];
    if (evidence.specialties) parts.push(`Lists "${evidence.specialties}" as a specialty`);
    if (evidence.procedures) parts.push(`offers "${evidence.procedures}" procedures`);
    if (evidence.equipment) parts.push(`equipment records confirm "${evidence.equipment}"`);
    if (parts.length > 0) return `${parts.join("; ")}. Multiple independent sources confirm this service.`;
    return "Multiple independent data sources confirm this service.";
  }

  if (trust === "partial") {
    if (evidence.procedures) {
      return `Found "${evidence.procedures}" in procedures but not in structured specialty codes. One solid source — verify directly.`;
    }
    if (evidence.equipment) {
      return `Equipment records mention "${evidence.equipment}" but no specialty listing confirms it. Verify directly.`;
    }
    const cap = String(row.capability ?? "").toLowerCase();
    if (matchesAny(cap, keywordTerms(keyword))) {
      return "Listed in facility's capability claims but not confirmed by specialty codes. Verify directly.";
    }
    return "One data source mentions this service. Not independently corroborated.";
  }

  // weak
  if (evidence.description) {
    return `Mentioned only in the facility's general description: "${evidence.description.slice(0, 100)}". No procedure or specialty listing confirms it — treat as unverified.`;
  }
  return "Weak or indirect mention only. Verify before referring.";
}

function generateExternalSources(name: string, city: string, state: string, keyword: string): ExternalSource[] {
  const q = encodeURIComponent(`${name} ${city || state} ${keyword} hospital India`);
  return [
    { name: "Google: " + name, url: `https://www.google.com/search?q=${q}` },
    { name: "NHM Facility Directory", url: "https://nhm.gov.in/index4.php?lang=1&level=0&linkid=150&lid=171" },
    { name: "NFHS-5 District Health Data", url: "https://rchiips.org/nfhs/NFHS-5_FCTS/FactSheets.shtml" },
  ];
}

function cleanCandidate(c: Partial<ReferralCandidate>): ReferralCandidate | null {
  const lat = finiteNumber(c.lat);
  const lon = finiteNumber(c.lon);
  const distanceKm = finiteNumber(c.distanceKm);
  const trust = c.trust === "strong" || c.trust === "partial" || c.trust === "weak" ? c.trust : "weak";
  if (!c.facilityId || !c.name || lat == null || lon == null || distanceKm == null) return null;
  return {
    facilityId: String(c.facilityId),
    name: String(c.name),
    city: String(c.city ?? ""),
    state: String(c.state ?? ""),
    lat,
    lon,
    distanceKm,
    trust,
    citation: String(c.citation ?? "").trim(),
    matchingEvidence: Array.isArray(c.matchingEvidence) ? c.matchingEvidence.map(String) : [],
    missingEvidence: Array.isArray(c.missingEvidence) ? c.missingEvidence.map(String) : [],
    explanation: String(c.explanation ?? ""),
    fieldEvidence: c.fieldEvidence,
    qualitativeAnalysis: c.qualitativeAnalysis ? String(c.qualitativeAnalysis) : undefined,
    rankReason: c.rankReason ? String(c.rankReason) : undefined,
    externalSources: Array.isArray(c.externalSources) ? c.externalSources : undefined,
  };
}

const RADIUS_ESCALATION = [100, 200];

async function runCapabilitySearch(capability: string, lat: number, lon: number, radius: number): Promise<ReferralCandidate[]> {
  const { rows } = await runSql(
    `SELECT * FROM (
       SELECT fc.unique_id AS facility_id, fb.name, fb.city, fb.state, fb.latitude, fb.longitude,
              fc.trust, fc.citation,
              fb.specialties, fb.procedure, fb.equipment, fb.description, fb.capability AS fb_capability,
              (6371 * acos(
                LEAST(1.0, cos(radians(:lat)) * cos(radians(fb.latitude))
                * cos(radians(fb.longitude) - radians(:lon))
                + sin(radians(:lat)) * sin(radians(fb.latitude)))
              )) AS distance_km
       FROM workspace.meddesert.facility_base fb
       JOIN workspace.meddesert.facility_capability fc ON fb.unique_id = fc.unique_id
       WHERE fc.capability = :cap AND fc.trust <> 'none'
         AND fb.latitude IS NOT NULL AND fb.longitude IS NOT NULL
     ) t
     WHERE distance_km < :radius
     ORDER BY CASE trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END, distance_km
     LIMIT 10`,
    [
      { name: "cap", value: capability, type: "STRING" },
      { name: "lat", value: lat, type: "DOUBLE" },
      { name: "lon", value: lon, type: "DOUBLE" },
      { name: "radius", value: radius, type: "DOUBLE" },
    ]
  );

  return rows.map((r) => {
    const trust = r.trust === "strong" || r.trust === "partial" || r.trust === "weak" ? r.trust : "weak";
    const citation = cleanCitation(String(r.citation ?? ""), capability);
    const rowForEvidence = { ...r, capability: r.fb_capability };
    const fieldEv = extractFieldEvidence(rowForEvidence, capability);
    const missing = computeMissingEvidence(rowForEvidence, capability);
    const explanation = computeExplanation(rowForEvidence, capability, trust, fieldEv);
    const matchEv = buildMatchingEvidence(fieldEv);
    const name = String(r.name ?? "");
    const city = String(r.city ?? "");
    const state = String(r.state ?? "");
    return cleanCandidate({
      facilityId: String(r.facility_id ?? ""),
      name,
      city,
      state,
      lat: Number(r.latitude),
      lon: Number(r.longitude),
      trust,
      citation,
      distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
      matchingEvidence: matchEv.length > 0 ? matchEv : (citation ? [citation] : []),
      missingEvidence: missing,
      explanation,
      fieldEvidence: fieldEv,
      externalSources: generateExternalSources(name, city, state, capability),
    });
  }).filter((c): c is ReferralCandidate => c !== null);
}

async function execSearchByCapability(args: Record<string, unknown>): Promise<ReferralCandidate[]> {
  const capability = String(args.capability ?? "").toLowerCase();
  const lat = finiteNumber(args.lat);
  const lon = finiteNumber(args.lon);
  if (!(CAPS as readonly string[]).includes(capability) || lat == null || lon == null) {
    throw new Error("valid capability and lat/lon required");
  }

  const initialRadius = cleanRadius(args.radius_km);
  let results = await runCapabilitySearch(capability, lat, lon, initialRadius);

  for (const wider of RADIUS_ESCALATION) {
    if (results.length >= SYNONYM_THRESHOLD) break;
    if (wider <= initialRadius) continue;
    results = deduplicateCandidates([...results, ...(await runCapabilitySearch(capability, lat, lon, wider))]);
  }

  return rankCandidates(results.slice(0, 10));
}

async function runKeywordSearch(keyword: string, lat: number, lon: number, radius: number): Promise<ReferralCandidate[]> {
  const kw = `%${keyword}%`;
  const { rows } = await runSql(
    `SELECT * FROM (
       SELECT fb.unique_id, fb.name, fb.city, fb.state, fb.latitude, fb.longitude,
              fb.specialties, fb.procedure, fb.equipment, fb.description,
              CASE
                WHEN lower(coalesce(fb.specialties,'')) LIKE :kw THEN 'strong'
                WHEN lower(coalesce(fb.capability,'')) LIKE :kw THEN 'partial'
                WHEN lower(coalesce(fb.procedure,'')) LIKE :kw OR lower(coalesce(fb.equipment,'')) LIKE :kw THEN 'partial'
                WHEN lower(coalesce(fb.description,'')) LIKE :kw THEN 'weak'
                ELSE 'weak'
              END AS computed_trust,
              coalesce(
                nullif(regexp_extract(coalesce(fb.procedure,''), concat('(?i)([^",.]*', :kw_raw, '[^",.]*)')  , 1), ''),
                nullif(regexp_extract(coalesce(fb.equipment,''), concat('(?i)([^",.]*', :kw_raw, '[^",.]*)')  , 1), ''),
                nullif(regexp_extract(coalesce(fb.description,''), concat('(?i)([^.]*', :kw_raw, '[^.]*)')   , 1), ''),
                nullif(regexp_extract(coalesce(fb.specialties,''), concat('(?i)([^,]*', :kw_raw, '[^,]*)')   , 1), ''),
                nullif(regexp_extract(coalesce(fb.capability,''), concat('(?i)([^"]*', :kw_raw, '[^"]*)')    , 1), ''),
                ''
              ) AS citation,
              (6371 * acos(
                LEAST(1.0, cos(radians(:lat)) * cos(radians(fb.latitude))
                * cos(radians(fb.longitude) - radians(:lon))
                + sin(radians(:lat)) * sin(radians(fb.latitude)))
              )) AS distance_km
       FROM workspace.meddesert.facility_base fb
       WHERE lower(concat_ws(' ', coalesce(fb.description,''), coalesce(fb.procedure,''),
                   coalesce(fb.equipment,''), coalesce(fb.specialties,''), coalesce(fb.capability,''))) LIKE :kw
         AND fb.latitude IS NOT NULL AND fb.longitude IS NOT NULL
     ) t
     WHERE distance_km < :radius
     ORDER BY CASE computed_trust WHEN 'strong' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END, distance_km
     LIMIT 10`,
    [
      { name: "kw", value: kw, type: "STRING" },
      { name: "kw_raw", value: keyword, type: "STRING" },
      { name: "lat", value: lat, type: "DOUBLE" },
      { name: "lon", value: lon, type: "DOUBLE" },
      { name: "radius", value: radius, type: "DOUBLE" },
    ]
  );

  return rows.map((r) => {
    const trust = r.computed_trust === "strong" || r.computed_trust === "partial" || r.computed_trust === "weak" ? r.computed_trust : "weak";
    const citation = cleanCitation(String(r.citation ?? ""), keyword);
    const fieldEv = extractFieldEvidence(r, keyword);
    const missing = computeMissingEvidence(r, keyword);
    const explanation = computeExplanation(r, keyword, trust, fieldEv);
    const matchEv = buildMatchingEvidence(fieldEv);
    const name = String(r.name ?? "");
    const city = String(r.city ?? "");
    const state = String(r.state ?? "");
    return cleanCandidate({
      facilityId: String(r.unique_id ?? ""),
      name,
      city,
      state,
      lat: Number(r.latitude),
      lon: Number(r.longitude),
      trust,
      citation,
      distanceKm: Math.round(Number(r.distance_km) * 10) / 10,
      matchingEvidence: matchEv.length > 0 ? matchEv : (citation ? [citation] : []),
      missingEvidence: missing,
      explanation,
      fieldEvidence: fieldEv,
      externalSources: generateExternalSources(name, city, state, keyword),
    });
  }).filter((c): c is ReferralCandidate => c !== null);
}

function deduplicateCandidates(candidates: ReferralCandidate[]): ReferralCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.facilityId)) return false;
    seen.add(c.facilityId);
    return true;
  });
}

async function searchKeywordWithSynonyms(keyword: string, lat: number, lon: number, radius: number): Promise<ReferralCandidate[]> {
  let results = await runKeywordSearch(keyword, lat, lon, radius);

  if (results.length < SYNONYM_THRESHOLD) {
    const synonyms = getSynonyms(keyword);
    for (const syn of synonyms) {
      if (results.length >= 10) break;
      const synResults = await runKeywordSearch(syn, lat, lon, radius);
      results = deduplicateCandidates([...results, ...synResults]);
    }
  }

  return results;
}

async function execSearchByKeyword(args: Record<string, unknown>): Promise<ReferralCandidate[]> {
  const keyword = stripLikeWildcards(String(args.keyword ?? ""));
  const lat = finiteNumber(args.lat);
  const lon = finiteNumber(args.lon);
  if (!keyword || lat == null || lon == null) throw new Error("valid keyword and lat/lon required");

  const initialRadius = cleanRadius(args.radius_km);
  let results = await searchKeywordWithSynonyms(keyword, lat, lon, initialRadius);

  for (const wider of RADIUS_ESCALATION) {
    if (results.length >= SYNONYM_THRESHOLD) break;
    if (wider <= initialRadius) continue;
    results = deduplicateCandidates([...results, ...(await searchKeywordWithSynonyms(keyword, lat, lon, wider))]);
  }

  return rankCandidates(results.slice(0, 10));
}

async function execGetLocationCoords(args: Record<string, unknown>) {
  const place = stripLikeWildcards(String(args.place_name ?? ""));
  if (!place) throw new Error("place_name required");

  const { rows } = await runSql(
    `SELECT round(avg(latitude), 4) AS lat, round(avg(longitude), 4) AS lon, count(*) AS n
     FROM workspace.meddesert.facility_base
     WHERE (lower(city) LIKE :place OR lower(state) LIKE :place)
       AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    [{ name: "place", value: `%${place}%`, type: "STRING" }]
  );
  if (!rows.length || rows[0].lat == null) return { lat: null, lon: null, found: false };
  return { lat: Number(rows[0].lat), lon: Number(rows[0].lon), found: true, facilitiesInArea: Number(rows[0].n ?? 0) };
}

const DEADLINE_MS = 90_000;
const PER_CALL_TIMEOUT_MS = 60_000;

async function callMosaic(endpoint: string, token: string, messages: Message[]): Promise<MosaicMessage> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools: TOOLS, tool_choice: "auto" }),
    signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mosaic AI ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as MosaicResponse;
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("No response from Mosaic AI");
  return msg;
}

function parseMayaResponse(finalResponse: string): ParsedMayaResponse {
  try {
    const parsed = JSON.parse(finalResponse) as ParsedMayaResponse;
    return parsed && typeof parsed === "object" ? parsed : { answer: finalResponse };
  } catch {
    return { answer: finalResponse };
  }
}

const MAX_HISTORY = 20;

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.slice(-MAX_HISTORY) as HistoryEntry[];
  return entries
    .filter((e) => e && (e.role === "user" || e.role === "assistant") && typeof e.content === "string")
    .map((e) => ({ role: e.role, content: e.content.slice(0, 2000) }));
}

export async function POST(req: Request) {
  let body: { question?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });

  const mosaicEndpoint = process.env.MOSAIC_AI_ENDPOINT;
  const dbxToken = process.env.DATABRICKS_TOKEN;
  if (!mosaicEndpoint || !dbxToken) {
    return NextResponse.json({ ok: false, error: "I'm having trouble connecting to my search service right now. Please try again in a moment." }, { status: 500 });
  }

  try {
    const t0 = Date.now();
    const history = sanitizeHistory(body.history);
    const messages: Message[] = [
      { role: "system", content: MAYA_SYSTEM_PROMPT },
      ...history,
      { role: "user", content: question },
    ];
    let finalResponse: string | null = null;
    let latestCandidates: ReferralCandidate[] = [];
    let searchKeyword = "";

    for (let round = 0; round < 5; round++) {
      if (Date.now() - t0 > DEADLINE_MS) break;
      const msg = await callMosaic(mosaicEndpoint, dbxToken, messages);

      if (msg.tool_calls?.length) {
        messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

        for (const tc of msg.tool_calls) {
          let result: unknown;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            result = { error: "invalid tool arguments" };
            messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
            continue;
          }

          try {
            switch (tc.function.name) {
              case "search_facilities_by_capability":
                latestCandidates = await execSearchByCapability(args);
                searchKeyword = String(args.capability ?? "");
                result = latestCandidates;
                break;
              case "search_facilities_by_keyword":
                latestCandidates = await execSearchByKeyword(args);
                searchKeyword = String(args.keyword ?? "");
                result = latestCandidates;
                break;
              case "get_location_coords":
                result = await execGetLocationCoords(args);
                break;
              default:
                result = { error: `Unknown tool: ${tc.function.name}` };
            }
          } catch (toolErr) {
            console.error("[Maya tool error]", tc.function.name, toolErr instanceof Error ? toolErr.message : toolErr);
            result = { error: "Search could not be completed. Please try a different query." };
          }

          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }
      } else {
        finalResponse = msg.content ?? "";
        break;
      }
    }

    if (!finalResponse) {
      return NextResponse.json({ ok: false, error: "I wasn't able to complete the search after several attempts. Please try a simpler question." }, { status: 500 });
    }

    const parsed = parseMayaResponse(finalResponse);
    let candidates = latestCandidates.length > 0 ? latestCandidates : (
      Array.isArray(parsed.candidates)
        ? parsed.candidates.map(cleanCandidate).filter((c): c is ReferralCandidate => c !== null)
        : []
    );

    // Enrich with rank reasons
    candidates = computeRankReasons(candidates);

    // Enrich with Cerebras qualitative analysis (parallel, non-blocking)
    if (candidates.length > 0 && searchKeyword && process.env.CEREBRAS_API_KEY) {
      try {
        const evidenceMap = new Map<string, FieldEvidence>();
        for (const c of candidates) {
          if (c.fieldEvidence) evidenceMap.set(c.facilityId, c.fieldEvidence);
        }
        const analyses = await generateBatchAnalysis(candidates, searchKeyword, evidenceMap);
        candidates = candidates.map((c) => {
          const analysis = analyses.get(c.facilityId);
          return analysis ? { ...c, qualitativeAnalysis: analysis } : c;
        });
      } catch {
        // Cerebras failure — candidates keep deterministic explanations
      }
    }

    return NextResponse.json({
      ok: true,
      question,
      answer: parsed.answer ?? finalResponse,
      reasoningSteps: Array.isArray(parsed.reasoning_steps) ? parsed.reasoning_steps.map(String) : [],
      resolvedNeed: parsed.resolved_need ?? "",
      resolvedLocation: parsed.resolved_location ?? "",
      candidates,
      meta: { ms: Date.now() - t0, rows: candidates.length, source: "workspace.meddesert.facility_base + facility_capability", engine: "Maya - Mosaic AI + Cerebras + Databricks SQL" },
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "";
    const name = e instanceof Error ? e.name : "";
    let userMessage: string;
    if (name === "TimeoutError" || name === "AbortError" || raw.includes("timed out") || raw.includes("TIMEOUT") || raw.includes("deadline")) {
      userMessage = "The search took too long to complete. The data warehouse may be warming up — please try again in about 30 seconds.";
    } else if (raw.includes("Mosaic AI")) {
      userMessage = "I'm having trouble connecting to my search service right now. Please try again in a moment.";
    } else {
      userMessage = "Something went wrong with my search. Please rephrase your question and try again.";
    }
    return NextResponse.json({ ok: false, error: userMessage }, { status: 500 });
  }
}
