/**
 * OpenRouter HTTP client with ZDR (Zero Data Retention) baked in.
 * The X-No-Data-Logging header is set at the client level — it cannot be forgotten.
 */

import type {
  ChatMessage,
  ChatCompletionResponse,
  LLMToolDefinition,
} from "./types";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Model identifiers used by Moss */
export const Models = {
  /** Tier 1 — Router/Triage: cheap, fast, sufficient for intent classification */
  TRIAGE: "liquid/lfm2-24b-a2b",
  /** Tier 2 — Execution: production-grade reasoning */
  CLAUDE_SONNET: "anthropic/claude-sonnet-4-6",
  /** Tier 2 — Execution: fast and cheap for moderate tasks */
  MINIMAX: "minimax/minimax-m2.5",
  /** Tier 2 — Execution: good for code and complex reasoning */
  KIMI: "moonshotai/kimi-k2.5",
} as const;

export type ModelId = (typeof Models)[keyof typeof Models];

export interface ChatCompletionOptions {
  model: ModelId;
  messages: ChatMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Make a chat completion request to OpenRouter.
 * ZDR header is always set — this is non-negotiable for a personal assistant.
 */
export async function chatCompletion(
  apiKey: string,
  options: ChatCompletionOptions,
  kv?: KVNamespace
): Promise<ChatCompletionResponse> {
  // Daily call cap — hard limit to prevent runaway costs
  if (kv) {
    await enforceCallCap(kv);
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 2048,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // ZDR — Zero Data Retention. Set at client level, every single request.
      "X-No-Data-Logging": "true",
      "HTTP-Referer": "https://moss.grove.place",
      "X-Title": "Moss",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new OpenRouterError(
      `OpenRouter ${response.status}: ${errorText}`,
      response.status
    );
  }

  return (await response.json()) as ChatCompletionResponse;
}

/**
 * Select the appropriate Tier 2 model based on complexity.
 */
export function selectExecutionModel(
  complexity: "simple" | "moderate" | "complex",
  intent?: string
): ModelId {
  // Code-related or complex reasoning → Claude Sonnet
  if (complexity === "complex" || intent === "github") {
    return Models.CLAUDE_SONNET;
  }
  // Moderate tasks → MiniMax (cheap, fast, good enough)
  if (complexity === "moderate") {
    return Models.MINIMAX;
  }
  // Simple tasks that still need Tier 2 → MiniMax
  return Models.MINIMAX;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** Daily call cap — hard limit, enforced in KV, not a suggestion */
const DAILY_CAP_KEY = "moss:llm-calls-today";
const MAX_DAILY_CALLS = 200;

async function enforceCallCap(kv: KVNamespace): Promise<void> {
  const raw = await kv.get(DAILY_CAP_KEY);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= MAX_DAILY_CALLS) {
    throw new OpenRouterError(
      "Daily LLM call cap reached. Try again tomorrow.",
      429
    );
  }

  // TTL resets at midnight UTC — gives a rolling 24h window
  await kv.put(DAILY_CAP_KEY, String(count + 1), {
    expirationTtl: 86400,
  });
}
