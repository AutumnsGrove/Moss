/**
 * Telegram Bot API client.
 * Handles outbound messages and webhook verification.
 */

const TELEGRAM_API = "https://api.telegram.org";

export interface SendMessageOptions {
  chatId: number;
  text: string;
  parseMode?: "MarkdownV2" | "HTML";
  replyToMessageId?: number;
}

/**
 * Send a message via Telegram Bot API.
 * Uses MarkdownV2 by default for rich formatting.
 */
export async function sendMessage(
  token: string,
  options: SendMessageOptions
): Promise<boolean> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: options.chatId,
    text: options.text,
  };

  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // If MarkdownV2 fails (common with special chars), retry as plain text
    if (options.parseMode) {
      return sendMessage(token, {
        ...options,
        parseMode: undefined,
      });
    }
    return false;
  }

  return true;
}

/**
 * Verify the Telegram webhook secret header.
 * Returns true if the secret matches, false otherwise.
 */
export function verifyWebhookSecret(
  request: Request,
  expectedSecret: string
): boolean {
  const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!header || !expectedSecret) return false;

  // Constant-time comparison to prevent timing attacks
  if (header.length !== expectedSecret.length) return false;

  let mismatch = 0;
  for (let i = 0; i < header.length; i++) {
    mismatch |= header.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
  }
  return mismatch === 0;
}

export interface SendMessageResult {
  ok: boolean;
  message_id?: number;
}

/**
 * Send a message and return the message ID (needed for progress log editing).
 */
export async function sendMessageWithId(
  token: string,
  options: SendMessageOptions
): Promise<SendMessageResult> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: options.chatId,
    text: options.text,
  };

  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (options.parseMode) {
      return sendMessageWithId(token, { ...options, parseMode: undefined });
    }
    return { ok: false };
  }

  const data = (await response.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };

  return {
    ok: data.ok,
    message_id: data.result?.message_id,
  };
}

export interface EditMessageOptions {
  chatId: number;
  messageId: number;
  text: string;
  parseMode?: "MarkdownV2" | "HTML";
}

/**
 * Edit an existing message via Telegram Bot API.
 * Used for real-time progress log updates.
 */
export async function editMessageText(
  token: string,
  options: EditMessageOptions
): Promise<boolean> {
  const url = `${TELEGRAM_API}/bot${token}/editMessageText`;

  const body: Record<string, unknown> = {
    chat_id: options.chatId,
    message_id: options.messageId,
    text: options.text,
  };

  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok && options.parseMode) {
    return editMessageText(token, { ...options, parseMode: undefined });
  }

  return response.ok;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * Required characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

/**
 * Send a typing indicator to show Moss is "thinking".
 */
export async function sendTypingAction(
  token: string,
  chatId: number
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}
