/**
 * Memory extraction from conversations.
 * Uses LFM to extract facts, episode summaries, and core block updates.
 */

import type { Env } from "../shared/env";
import type { ConversationMessage } from "../shared/types";
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

interface ExtractionResult {
  facts: Array<{
    content: string;
    confidence: "confirmed" | "inferred";
    needs_confirmation: boolean;
  }>;
  episode_summary: string;
  mood_signal: string | null;
  core_block_updates: Array<{
    field: string;
    value: string;
    reason: string;
  }>;
}

/**
 * Extract memory artifacts from a conversation transcript.
 */
export async function extractMemory(
  env: Env,
  messages: ConversationMessage[]
): Promise<void> {
  // Format the transcript
  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  // Call LFM for extraction
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
  if (!content) return;

  const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const result = safeJsonParse<ExtractionResult>(jsonStr);
  if (!result) return;

  const timestamp = now();

  // Batch all DB writes using D1's batch API for performance
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

  // Inferred facts that need confirmation are held — they'll be sent as
  // confirmation requests in a future message. For v1, we store them as
  // inferred with a flag for the agent to ask about later.
  const inferredFacts = result.facts.filter((f) => f.needs_confirmation);
  for (const fact of inferredFacts) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO moss_facts (id, content, confidence, embedding_id, created_at, updated_at, deleted_at, source)
         VALUES (?, ?, 'inferred', NULL, ?, ?, NULL, 'conversation:pending_confirmation')`
      ).bind(generateId(), fact.content, timestamp, timestamp)
    );
  }

  // Execute all inserts in a single batch (one round-trip to D1)
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  // Core block updates are logged but not applied — owner must confirm
  // Future: send confirmation message via Telegram
}
