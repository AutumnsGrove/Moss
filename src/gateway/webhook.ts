/**
 * Telegram webhook verification and update parsing.
 */

import type { TelegramUpdate } from "../shared/types";
import { verifyWebhookSecret } from "../shared/telegram";
import { safeJsonParse } from "../shared/utils";

export interface WebhookValidation {
  valid: boolean;
  update?: TelegramUpdate;
  error?: string;
}

/**
 * Validate and parse an incoming Telegram webhook request.
 * Returns the parsed update if valid, or an error description.
 */
export async function validateWebhook(
  request: Request,
  webhookSecret: string
): Promise<WebhookValidation> {
  // Only accept POST requests
  if (request.method !== "POST") {
    return { valid: false, error: "method_not_allowed" };
  }

  // Verify the webhook secret header
  if (!verifyWebhookSecret(request, webhookSecret)) {
    return { valid: false, error: "invalid_secret" };
  }

  // Parse the request body
  const bodyText = await request.text();
  const update = safeJsonParse<TelegramUpdate>(bodyText);

  if (!update) {
    return { valid: false, error: "invalid_body" };
  }

  return { valid: true, update };
}
