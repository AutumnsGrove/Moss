/**
 * Cloudflare Worker environment bindings.
 * All secrets are stored in CF Secrets, never in KV or D1.
 */
export interface Env {
  // --- Cloudflare Bindings ---
  DB: D1Database;
  KV: KVNamespace;
  QUEUE: Queue;

  // --- Secrets (CF Secrets, never logged) ---
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OPENROUTER_API_KEY: string;
  GITHUB_PAT_READ: string;
  GITHUB_PAT_WRITE: string;
  HEARTWOOD_SERVICE_TOKEN: string;

  // --- Modal Secrets ---
  MODAL_ENDPOINT_URL: string;
  MODAL_AUTH_KEY: string;
  MODAL_AUTH_SECRET: string;

  // --- Config ---
  OWNER_TELEGRAM_ID: string;
  ENVIRONMENT: string;
}

/** Queue message types for routing within the queue consumer */
export type QueueMessageBody =
  | { type: "agent"; chatId: number; text: string; messageId: number }
  | { type: "command"; chatId: number; command: string; args: string }
  | { type: "memory_write"; conversationId: string };
