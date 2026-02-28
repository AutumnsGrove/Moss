/**
 * Memory extraction from conversations.
 *
 * Primary: Modal (LFM on your own GPU)
 * Fallback: OpenRouter (LFM2-24B-A2B, degraded mode)
 *
 * Extracts facts, episode summaries, mood signals, and core block update proposals.
 */

import type { Env } from "../shared/env";
import type {
  ConversationMessage,
  ModalMemoryExtractionResponse,
} from "../shared/types";
import { extractMemoryViaModal } from "../shared/providers";
import { chatCompletion, Models } from "../shared/openrouter";
import { generateId, now, safeJsonParse } from "../shared/utils";

const EXTRACTION_PROMPT = `You are Moss's memory extraction layer. Read the conversation transcript and extract:

1. **facts**: Discrete facts or preferences explicitly stated by the user. Each fact is a short sentence.
   - confidence: "confirmed" if explicitly stated, "inferred" if you're guessing
   - For inferred facts, set needs_confirmation: true
2. **episode_summary**: A 1-2 sentence summary of what happened in this conversation, including tone/energy if notable.
3. **mood_signal**: Optional. Only set if the user's mood is clearly evident (e.g., "stressed", "energetic", "frustrated"). null if unclear.
4. **core_block_updates**: Any changes that should be proposed to the owner's core profile. Empty array if none.

Respond with ONLY a JSON object:
{
  "facts": [{ "content": "...", "confidence": "confirmed"|"inferred", "needs_confirmation": boolean }],
  "episode_summary": "...",
  "mood_signal": "..." | null,
  "core_block_updates": [{ "field": "...", "value": "...", "reason": "..." }]
}

Rules:
- Do NOT extract trivial facts (greetings, filler)
- Do NOT re-extract facts that are obvious from context (e.g., "uses Telegram")
- Be conservative — fewer high-quality extractions beat many low-quality ones
- Health/mood observations: ALWAYS set needs_confirmation: true`;

/**
 * Extract memory artifacts from a conversation transcript.
 * Uses Modal first, falls back to OpenRouter.
 */
export async function extractMemory(
  env: Env,
  messages: ConversationMessage[]
): Promise<void> {
  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  // Try Modal first, fall back to OpenRouter
  const result = await extractViaModalOrFallback(env, transcript);
  if (!result || (!result.facts.length && !result.episode_summary)) return;

  await storeExtractionResults(env, result);
}

/**
 * Extract via Modal, with OpenRouter fallback.
 */
async function extractViaModalOrFallback(
  env: Env,
  transcript: string
): Promise<ModalMemoryExtractionResponse | null> {
  // Try Modal first
  const modalResult = await extractMemoryViaModal(env, transcript);
  if (modalResult.facts.length > 0 || modalResult.episode_summary) {
    return modalResult;
  }

  // Fallback to OpenRouter
  try {
    const response = await chatCompletion(env.OPENROUTER_API_KEY, {
      model: Models.TRIAGE,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: `Transcript:\n\n${transcript}` },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return safeJsonParse<ModalMemoryExtractionResponse>(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Store extraction results in D1.
 */
async function storeExtractionResults(
  env: Env,
  result: ModalMemoryExtractionResponse
): Promise<void> {
  const timestamp = now();
  const statements: D1PreparedStatement[] = [];

  // Store confirmed facts immediately
  const confirmedFacts = result.facts.filter((f) => !f.needs_confirmation);
  for (const fact of confirmedFacts) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO moss_facts (id, content, confidence, embedding_id, created_at, updated_at, deleted_at, source)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, 'conversation')`
      ).bind(generateId(), fact.content, fact.confidence, timestamp, timestamp)
    );
  }

  // Store episode summary
  if (result.episode_summary) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO moss_episodes (id, summary, mood_signal, embedding_id, created_at, deleted_at)
         VALUES (?, ?, ?, NULL, ?, NULL)`
      ).bind(generateId(), result.episode_summary, result.mood_signal, timestamp)
    );
  }

  // Inferred facts stored with pending_confirmation source
  const inferredFacts = result.facts.filter((f) => f.needs_confirmation);
  for (const fact of inferredFacts) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO moss_facts (id, content, confidence, embedding_id, created_at, updated_at, deleted_at, source)
         VALUES (?, ?, 'inferred', NULL, ?, ?, NULL, 'conversation:pending_confirmation')`
      ).bind(generateId(), fact.content, timestamp, timestamp)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}
