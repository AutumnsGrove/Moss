/**
 * moss-gateway: Entry point for Telegram webhook handling.
 *
 * Responsibilities:
 * 1. Verify Telegram webhook secret
 * 2. Check sender against owner allowlist
 * 3. Apply rate limiting
 * 4. Route to agent (queue) or drop
 */

import type { Env } from "../shared/env";
import { logError } from "../shared/utils";
import { validateWebhook } from "./webhook";
import { routeUpdate, enqueueForAgent } from "./router";
import { checkRateLimit } from "./ratelimit";

/**
 * Handle an incoming fetch request (Telegram webhook).
 * Returns 200 OK for all valid webhooks (Telegram expects this).
 * Unknown senders get 200 with no response — silent drop.
 */
export async function handleGatewayRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // Health check endpoint
  if (new URL(request.url).pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  // Only handle the webhook path
  if (new URL(request.url).pathname !== "/telegram") {
    return new Response("not found", { status: 404 });
  }

  try {
    // Step 1: Validate webhook
    const validation = await validateWebhook(
      request,
      env.TELEGRAM_WEBHOOK_SECRET
    );
    if (!validation.valid || !validation.update) {
      // Invalid webhooks get 200 to avoid Telegram retries on auth failures
      return new Response("ok", { status: 200 });
    }

    // Step 2: Route the update (includes owner-only check)
    const decision = routeUpdate(validation.update, env.OWNER_TELEGRAM_ID);

    if (decision.action === "drop") {
      // Silent drop — don't confirm the bot exists to strangers
      return new Response("ok", { status: 200 });
    }

    // Step 3: Rate limiting
    if (decision.chatId) {
      const allowed = await checkRateLimit(
        env.KV,
        String(decision.chatId)
      );
      if (!allowed) {
        // Rate limited — silently drop, the owner will figure it out
        return new Response("ok", { status: 200 });
      }
    }

    // Step 4: Enqueue for agent processing
    await enqueueForAgent(env, decision);

    return new Response("ok", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    await logError(env.DB, message, "gateway");
    // Always return 200 to Telegram — never expose errors
    return new Response("ok", { status: 200 });
  }
}
