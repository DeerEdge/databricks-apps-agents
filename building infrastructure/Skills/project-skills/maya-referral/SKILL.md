---
name: maya-referral
description: "Complete reference for the Maya Referral Copilot (Track 3): architecture, system prompt, tool definitions, SQL patterns, ranking logic, UI structure, and known pitfalls. Use before modifying any /referral route, MayaCopilot component, or referral lib code."
---

# Maya Referral Copilot — Skill Reference

## What Maya Is

Maya is a conversational AI referral copilot on the `/referral` page. A user types a
natural language care need + location (e.g., "dialysis near Jaipur") and Maya returns
ranked facility recommendations with cited evidence, distance, trust explanations, and
missing-evidence flags.

**Scope:** Track 3 of the hackathon. Lives alongside Track 2 (Medical Desert Planner)
as a separate Next.js App Router page.

---

## Architecture

```
User → MayaCopilot.tsx → POST /api/referral → Mosaic AI (tool-calling LLM)
                                                 ↓ tool calls
                                           execSearchByCapability / execSearchByKeyword / execGetLocationCoords
                                                 ↓ parameterized SQL
                                           Databricks SQL Statement API
                                                 ↓ results
                                           rankCandidates (src/lib/referral.ts)
                                                 ↓
                                           JSON response → UI renders cards + side panel
```

**Key files:**
- `src/app/api/referral/route.ts` — POST handler, Mosaic AI orchestration, tool execution
- `src/app/api/shortlist/route.ts` — GET/POST/DELETE for saved shortlist (Lakebase)
- `src/lib/referral.ts` — pure functions: Haversine, ranking, validation, types
- `src/components/MayaCopilot.tsx` — chat UI, result cards, slide-in side panel with map
- `src/app/referral/page.tsx` — page shell

---

## Mosaic AI Integration

**Endpoint:** `process.env.MOSAIC_AI_ENDPOINT` (Databricks Model Serving)
**Auth:** `Bearer ${DATABRICKS_TOKEN}` (same token as SQL)

The route runs a multi-round tool-calling loop (max 5 rounds):
1. Send system prompt + user question + tool definitions
2. If model returns `tool_calls`: execute them, append results, loop
3. If model returns text: parse as JSON, return to client

**The backend ALWAYS uses `latestCandidates` from tool execution** — not whatever Maya
puts in its JSON response. This guarantees cards show up whenever a search tool was called.

---

## System Prompt (current)

Maya is instructed to:
1. ALWAYS call `get_location_coords` first to resolve the place
2. ALWAYS call a search tool (`search_facilities_by_keyword` or `_by_capability`)
3. Return a SHORT JSON response (2-3 sentence answer, 3-5 reasoning steps)

Voice: formal, simple, concise. No essays. The UI cards handle detail.

---

## Tool Definitions

### `search_facilities_by_capability`
For the 6 known capabilities (icu, maternity, emergency, oncology, trauma, nicu).
Queries `facility_capability` (pre-computed trust) joined with `facility_base` (lat/lon).

### `search_facilities_by_keyword`
For arbitrary needs (dialysis, cardiac surgery, MRI, etc.).
Queries `facility_base` directly with dynamic trust computation:
- `specialties` field matches → strong
- `capability` JSON or `procedure`/`equipment` matches → partial
- `description` only → weak

### `get_location_coords`
Resolves "Jaipur" → lat/lon by averaging facility coordinates where `city LIKE '%jaipur%'`.

---

## SQL Patterns — Critical Gotchas

### No HAVING without GROUP BY
Databricks SQL does NOT allow `HAVING computed_col < value` without a GROUP BY.
**Always wrap in a subquery:**
```sql
SELECT * FROM (
  SELECT ..., (6371 * acos(...)) AS distance_km
  FROM ...
  WHERE ...
) t
WHERE distance_km < :radius
ORDER BY ...
```

### Citation extraction via regexp_extract
Do NOT use `substr(field, 1, 500)` — this shows irrelevant text if the keyword is deep
in the field. Use `regexp_extract` to pull the specific phrase/sentence:
```sql
coalesce(
  nullif(regexp_extract(coalesce(fb.procedure,''), concat('(?i)([^",.]*', :kw_raw, '[^",.]*)')  , 1), ''),
  nullif(regexp_extract(coalesce(fb.description,''), concat('(?i)([^.]*', :kw_raw, '[^.]*)')   , 1), ''),
  ...
)
```

### Parameterization
All queries use `:name` params via `runSql()`. The keyword LIKE value is sanitized:
```typescript
const kw = `%${keyword.toLowerCase().replace(/[%_]/g, "")}%`;
```

---

## Ranking Logic (src/lib/referral.ts)

```
rank_score = trust_weight / (1 + distance_km / 50)
```
- `trust_weight`: strong=1.0, partial=0.6, weak=0.2
- Primary sort: trust tier (strong > partial > weak)
- Secondary sort: distance within same tier
- A strong facility 30km away beats a weak one 5km away

---

## Trust Explanation + Missing Evidence

### `computeExplanation(row, keyword, trust)`
Explains WHY the trust tier was assigned based on which fields matched:
- Strong: "Corroborated across specialty codes + procedure listings."
- Partial: "Found in procedures but not in structured specialty codes."
- Weak: "Mentioned only in general description — unverified."

### `computeMissingEvidence(row, keyword)`
Flags what's absent:
- "Not in structured specialty codes"
- "Not listed in procedures"
- "No matching equipment mentioned"
- "Equipment data unavailable for this facility"

---

## UI Structure (MayaCopilot.tsx)

### Initial state (no messages)
- Centered "Maya" hero title + "Your Hospital Referral Copilot" subtitle
- Chatbox directly below hero (white, rounded, paperclip + up-arrow)
- Typewriter placeholder cycles through SUGGESTIONS

### After first message
- Hero disappears
- Messages list with avatars (M / You)
- Maya messages include: reasoning steps (animated), result cards (clickable)
- Chatbox moves to bottom composer

### Side panel (on card click)
- Slides in from right (420px wide)
- [X] close button top-right
- Mini MapLibre map zoomed to facility pin
- "Why recommended" card: trust badge (top-right), explanation (italic), citation (blockquote)
- "Missing / uncertain" card: bullet list of absent evidence
- "Save to Shortlist" button

### Terminology
- "Strong match" / "Partial match" / "Weak match" (NOT "evidence")
- Trust badges use existing `.trust--strong/partial/weak` CSS classes

---

## Lakebase (Shortlist Persistence)

Table: `saved_shortlist` (auto-created by `ensureSchema()` in `lakebase.ts`)
- Same connection pattern as `saved_scenario` / `facility_override`
- Functions: `saveShortlistItem`, `listShortlist`, `deleteShortlistItem`
- Validation: `validateShortlistInput()` in `referral.ts`

---

## Env Vars Required

```
MOSAIC_AI_ENDPOINT=https://<workspace>/serving-endpoints/<endpoint>/invocations
DATABRICKS_TOKEN=    (existing — same token)
DATABRICKS_HOST=     (existing)
DATABRICKS_WAREHOUSE_ID=  (existing)
LAKEBASE_INSTANCE=   (existing — "meddesert")
LAKEBASE_HOST=       (existing)
LAKEBASE_USER=       (existing)
```

---

## Known Issues / Lessons

1. **HAVING without GROUP BY breaks on Databricks** — always use subquery wrapper.
2. **Raw JSON in citations** — facility `procedure`/`capability` fields store JSON arrays
   as strings. Must parse or use regexp_extract; never show raw `["item","item"]` to user.
3. **Maya may skip tool calls** — if the system prompt isn't explicit enough, the LLM
   answers from context without searching. The prompt must say "ALWAYS call search tools."
4. **latestCandidates is the source of truth** — never rely on what Maya puts in its
   JSON `candidates` field; always prefer the backend's tool-execution results.
5. **Mosaic AI latency** — 20-50s is normal on Free Edition. Show loading animation.
6. **`useCallback` import** — was added to MayaCopilot.tsx but may not be used; check
   for unused import lint errors.
