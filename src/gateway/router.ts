/**
 * Gateway message routing.
 * Decides whether to handle a message synchronously or queue it for async processing.
 */

import type { Env, QueueMessageBody } from "../shared/env";
import type { TelegramUpdate } from "../shared/types";
import { sendTypingAction } from "../shared/telegram";

export interface RouteDecision {
  action: "process" | "queue" | "drop";
  chatId?: number;
  text?: string;
  messageId?: number;
}

/**
 * Route an incoming Telegram update.
 * - Messages from unauthorized senders are silently dropped (no response = don't confirm bot exists)
 * - Non-text messages are dropped for v1
 * - Valid messages are queued for async agent processing
 */
export function routeUpdate(
  update: TelegramUpdate,
  ownerTelegramId: string
): RouteDecision {
  const message = update.message;

  // Only handle direct messages with text content for v1
  if (!message?.text || !message.from) {
    return { action: "drop" };
  }

  // Owner-only enforcement: unknown senders are silently dropped
  if (String(message.from.id) !== ownerTelegramId) {
    return { action: "drop" };
  }

  // Input length guard — truncate excessively long messages
  const MAX_MESSAGE_LENGTH = 4000;
  const text = message.text.length > MAX_MESSAGE_LENGTH
    ? message.text.slice(0, MAX_MESSAGE_LENGTH)
    : message.text;

  // Valid message from owner — queue for processing
  return {
    action: "queue",
    chatId: message.chat.id,
    text,
    messageId: message.message_id,
  };
}

/**
 * Enqueue a message for async agent processing.
 * Sends a typing indicator immediately so the user sees Moss is working.
 */
export async function enqueueForAgent(
  env: Env,
  decision: RouteDecision
): Promise<void> {
  if (!decision.chatId || !decision.text || !decision.messageId) return;

  // Show typing indicator immediately
  await sendTypingAction(env.TELEGRAM_BOT_TOKEN, decision.chatId);

  // Enqueue for agent worker
  const body: QueueMessageBody = {
    type: "agent",
    chatId: decision.chatId,
    text: decision.text,
    messageId: decision.messageId,
  };

  await env.QUEUE.send(body);
}
