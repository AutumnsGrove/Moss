/**
 * moss-agent: Message processing and LLM orchestration.
 *
 * Two flows:
 * - Chat flow: triage → conversational model → single response (no ack, no log)
 * - Work flow: triage → ack → executor (Modal + tools) → progress log → final response
 *
 * The triage layer (Modal) decides which flow fires.
 */

import type { Env } from "../shared/env";
import { buildMemoryContext } from "../shared/memory";
import {
  sendMessage,
  sendMessageWithId,
  sendTypingAction,
} from "../shared/telegram";
import { conversationalResponse } from "../shared/providers";
import { generateId, now, logError, truncate } from "../shared/utils";
import { triageMessage, handleChatFlow } from "./triage";
import { executeWorkFlow, generateAcknowledgment } from "./executor";

const MOSS_SYSTEM_PROMPT = `You are Moss, a personal AI assistant for Autumn. You live inside Cloudflare's infrastructure and communicate via Telegram.

Personality:
- Conversational, warm, like a knowledgeable friend texting
- High technical depth — do not simplify unless asked
- One thing at a time, ADHD-friendly pacing
- No bullet walls — use prose
- Honest pushback when needed`;

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

    // Step 2: Triage via Modal (falls back to OpenRouter)
    const triage = await triageMessage(env, text, memory);

    // Step 3: Route based on triage decision
    if (triage.route_to === "simple_response") {
      // ─── Chat Flow ───
      // No ack, no progress log. Just a natural response.
      await sendTypingAction(env.TELEGRAM_BOT_TOKEN, chatId);

      const response = await handleChatFlow(env, text, memory);

      await sendMessage(env.TELEGRAM_BOT_TOKEN, {
        chatId,
        text: truncate(response, 4000),
        parseMode: "MarkdownV2",
        replyToMessageId: messageId,
      });

      await storeConversation(env, text, response);
    } else {
      // ─── Work Flow ───
      // Ack → executor (tools + progress log) → final response

      // Message 1: Acknowledgment (specific to what we're about to do)
      const ack = await generateAcknowledgment(env, text, triage);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, {
        chatId,
        text: ack,
        replyToMessageId: messageId,
      });

      // Message 2: Progress log (created by executor, edited in real-time)
      // Message 3: Final response
      const { response } = await executeWorkFlow(
        env,
        chatId,
        text,
        memory,
        triage
      );

      await sendMessage(env.TELEGRAM_BOT_TOKEN, {
        chatId,
        text: truncate(response, 4000),
        parseMode: "MarkdownV2",
      });

      await storeConversation(env, text, response);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown agent error";
    await logError(env.DB, errorMsg, "agent");

    // Pass error to conversational model for natural explanation
    try {
      const errorResponse = await conversationalResponse(env, [
        { role: "system", content: MOSS_SYSTEM_PROMPT },
        { role: "user", content: text },
        {
          role: "system",
          content: `An error occurred while processing: ${errorMsg}. Explain this to the user naturally and suggest next steps. Do not expose technical details.`,
        },
      ]);

      await sendMessage(env.TELEGRAM_BOT_TOKEN, {
        chatId,
        text: errorResponse || "Something went sideways. I logged the error — try again in a moment.",
      });
    } catch {
      // If even the error response fails, send a simple fallback
      await sendMessage(env.TELEGRAM_BOT_TOKEN, {
        chatId,
        text: "Something went sideways. I logged the error — try again in a moment.",
      });
    }
  }
}

/**
 * Process a /model command from the user.
 */
export async function processModelCommand(
  env: Env,
  chatId: number,
  args: string
): Promise<void> {
  const { setConversationalModel, getCurrentModelDisplay } = await import(
    "../shared/providers"
  );

  if (!args.trim()) {
    const current = await getCurrentModelDisplay(env.KV);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId,
      text: `Current model: ${current}\n\nAvailable: minimax, claude, kimi`,
    });
    return;
  }

  const result = await setConversationalModel(env.KV, args);
  if (!result) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId,
      text: `Unknown model "${args}". Available: minimax, claude, kimi`,
    });
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, {
    chatId,
    text: `Switched to ${result.display}.`,
  });
}

/**
 * Store the conversation exchange for later memory extraction.
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
