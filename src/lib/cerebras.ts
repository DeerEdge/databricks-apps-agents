import type { ReferralCandidate, FieldEvidence } from "./referral";

const DEFAULT_MODEL = "llama-3.3-70b";
const MAX_TOKENS = 150;
const TEMPERATURE = 0.3;
const TIMEOUT_MS = 8_000;

interface CerebrasMessage {
  role: "system" | "user";
  content: string;
}

interface CerebrasChoice {
  message?: { content?: string };
}

interface CerebrasResponse {
  choices?: CerebrasChoice[];
}

const SYSTEM_PROMPT = `You are a healthcare data analyst. Given structured evidence about a facility, write 2-3 sentences analyzing how well it matches the patient's care need.

Rules:
- Only reference data explicitly provided. Never invent capabilities.
- If evidence is weak or missing, say so honestly.
- Use plain language a non-technical planner can understand.
- Do NOT give medical advice or say "you should go here."
- Focus on what the evidence tells us and what's uncertain.`;

function buildUserPrompt(
  candidate: ReferralCandidate,
  keyword: string,
  evidence: FieldEvidence
): string {
  const lines = [
    `Care need: ${keyword}`,
    `Facility: ${candidate.name}, ${candidate.city || candidate.state} (${candidate.distanceKm.toFixed(1)} km away)`,
    `Trust tier: ${candidate.trust} match`,
    "",
    "Evidence found:",
    `- Specialties: ${evidence.specialties || "No match"}`,
    `- Procedures: ${evidence.procedures || "No match"}`,
    `- Equipment: ${evidence.equipment || "No match or data unavailable"}`,
    `- Description: ${evidence.description || "No relevant mention"}`,
  ];

  if (candidate.missingEvidence.length > 0) {
    lines.push("", `Missing/uncertain: ${candidate.missingEvidence.join("; ")}`);
  }

  lines.push("", "Analysis:");
  return lines.join("\n");
}

async function callCerebras(messages: CerebrasMessage[]): Promise<string> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("CEREBRAS_API_KEY not set");

  const model = process.env.CEREBRAS_MODEL || DEFAULT_MODEL;

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Cerebras ${res.status}`);
  }

  const data = (await res.json()) as CerebrasResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function generateFacilityAnalysis(
  candidate: ReferralCandidate,
  keyword: string,
  evidence: FieldEvidence
): Promise<string> {
  const messages: CerebrasMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(candidate, keyword, evidence) },
  ];
  return callCerebras(messages);
}

export async function generateBatchAnalysis(
  candidates: ReferralCandidate[],
  keyword: string,
  evidenceMap: Map<string, FieldEvidence>
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  if (!process.env.CEREBRAS_API_KEY || candidates.length === 0) {
    return results;
  }

  const promises = candidates.map(async (c) => {
    const evidence = evidenceMap.get(c.facilityId);
    if (!evidence) return;
    try {
      const analysis = await generateFacilityAnalysis(c, keyword, evidence);
      if (analysis) results.set(c.facilityId, analysis);
    } catch {
      // Individual failure — candidate keeps deterministic explanation
    }
  });

  await Promise.all(promises);
  return results;
}
