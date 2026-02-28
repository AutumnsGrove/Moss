/**
 * moss-memory-writer: Async queue consumer for memory extraction.
 *
 * After each conversation, the agent enqueues a memory_write job.
 * This worker reads the conversation transcript and extracts:
 * - Episode summary (D1)
 * - Facts/preferences (D1 + future Vectorize)
 * - Core block update proposals (held for confirmation)
 */

import type { Env } from "../shared/env";
import type { ConversationMessage } from "../shared/types";
import { safeJsonParse, logError } from "../shared/utils";
import { extractMemory } from "./extractor";

/**
 * Process a memory write job from the queue.
 */
export async function processMemoryWrite(
  env: Env,
  conversationId: string
): Promise<void> {
  try {
    // Load the conversation transcript from D1
    const result = await env.DB.prepare(
      `SELECT messages FROM moss_conversations WHERE id = ? AND processed = 0`
    )
      .bind(conversationId)
      .first<{ messages: string }>();

    if (!result) return; // Already processed or not found

    const messages = safeJsonParse<ConversationMessage[]>(result.messages);
    if (!messages || messages.length === 0) return;

    // Extract memory artifacts
    await extractMemory(env, messages);

    // Mark conversation as processed
    await env.DB.prepare(
      `UPDATE moss_conversations SET processed = 1 WHERE id = ?`
    )
      .bind(conversationId)
      .run();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown memory-writer error";
    await logError(env.DB, message, "memory-writer");
  }
}
