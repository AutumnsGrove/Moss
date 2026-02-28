/**
 * Moss — Main Worker Entry Point
 *
 * Single Cloudflare Worker with three event handlers:
 * - fetch:     Telegram webhook (gateway)
 * - queue:     Agent processing + memory writing
 * - scheduled: Cron-triggered reminders and digests
 *
 * The "four workers" from the spec are logical separations
 * implemented as modules within a single deployed Worker.
 */

import type { Env, QueueMessageBody } from "./shared/env";
import { handleGatewayRequest } from "./gateway/index";
import { processAgentMessage, processModelCommand } from "./agent/index";
import { processMemoryWrite } from "./memory/index";
import { handleScheduledEvent } from "./scheduler/index";
import { logError, safeJsonParse } from "./shared/utils";

export default {
  /**
   * HTTP fetch handler — Telegram webhook endpoint.
   * Handles: POST /telegram (webhook), GET /health (health check)
   */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleGatewayRequest(request, env);
  },

  /**
   * Queue consumer — processes agent messages and memory write jobs.
   * Messages are typed and routed to the appropriate handler.
   */
  async queue(batch: MessageBatch<QueueMessageBody>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body;

        switch (body.type) {
          case "agent":
            await processAgentMessage(
              env,
              body.chatId,
              body.text,
              body.messageId
            );
            break;

          case "command":
            if (body.command === "model") {
              await processModelCommand(env, body.chatId, body.args);
            }
            break;

          case "memory_write":
            await processMemoryWrite(env, body.conversationId);
            break;

          default:
            await logError(
              env.DB,
              `Unknown queue message type: ${JSON.stringify(body)}`,
              "queue"
            );
        }

        message.ack();
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown queue error";
        await logError(env.DB, errorMsg, "queue");
        message.retry();
      }
    }
  },

  /**
   * Scheduled (cron) handler — reminders and daily digests.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleScheduledEvent(event, env));
  },
};
