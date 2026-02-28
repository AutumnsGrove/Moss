/**
 * moss-agent: Message processing and LLM orchestration.
 *
 * Flow:
 * 1. Load memory context (Core Blocks + episodes + facts)
 * 2. Tier 1 triage (LFM — intent, complexity, routing)
 * 3. Route: simple_response (LFM handles) or full_agent (Tier 2 + tools)
 * 4. Send response via Telegram
 * 5. Store conversation for async memory extraction
 */

import type { Env } from "../shared/env";
import { buildMemoryContext } from "../shared/memory";
import { sendMessage } from "../shared/telegram";
import { generateId, now, logError, truncate } from "../shared/utils";
import { triageMessage, handleSimpleResponse } from "./triage";
import { executeAgentTurn } from "./executor";

/**
 * Process a message from the queue.
 * This is the main agent entry point.
 */
export async function processAgentMessage(
  env: Env,
  chatId: number,
  text: string,
  messageId: number
): Promise<void> {
  try {
    // Step 1: Load memory context
    const memory = await buildMemoryContext(env, text);

    // Step 2: Tier 1 triage
    const triage = await triageMessage(env, text, memory);

    // Step 3: Generate response based on routing decision
    let response: string;

    if (triage.route_to === "simple_response") {
      response = await handleSimpleResponse(env, text, memory);
    } else {
      response = await executeAgentTurn(env, text, memory, triage);
    }

    // Step 4: Send response via Telegram
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId,
      text: truncate(response, 4000), // Telegram message limit
      parseMode: "MarkdownV2",
      replyToMessageId: messageId,
    });

    // Step 5: Store conversation for async memory extraction
    await storeConversation(env, text, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown agent error";
    await logError(env.DB, message, "agent");

    // Send a generic error message — never expose internals
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId,
      text: "Something went sideways. I logged the error — try again in a moment.",
    });
  }
}

/**
 * Store the conversation exchange for later memory extraction.
 * The memory-writer worker will process this asynchronously.
 */
async function storeConversation(
  env: Env,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  const id = generateId();
  const timestamp = now();

  const messages = JSON.stringify([
    { role: "user", content: userMessage, timestamp },
    { role: "assistant", content: assistantResponse, timestamp },
  ]);

  await env.DB.prepare(
    `INSERT INTO moss_conversations (id, messages, started_at, ended_at, processed)
     VALUES (?, ?, ?, ?, 0)`
  )
    .bind(id, messages, timestamp, timestamp)
    .run();

  // Enqueue for async memory extraction
  await env.QUEUE.send({ type: "memory_write", conversationId: id });
}
