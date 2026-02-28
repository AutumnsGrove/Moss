/**
 * Modal HTTP client for Moss inference endpoints.
 * Handles all communication with the Modal GPU deployment.
 *
 * Modal never sees credentials (GitHub PATs, Telegram tokens, etc.).
 * It only does inference — receives context, produces structured output.
 */

import type {
  ModalTriageRequest,
  ModalTriageResponse,
  ModalExecuteRequest,
  ModalExecuteResponse,
  ModalVisionRequest,
  ModalVisionResponse,
  ModalMemoryExtractionRequest,
  ModalMemoryExtractionResponse,
  ModalHealthResponse,
} from "./types";

/** Timeout and retry configuration per endpoint */
const MODAL_CONFIG = {
  triage_timeout_ms: 10_000,    // 10s (includes potential cold start)
  execute_timeout_ms: 30_000,   // 30s (multi-round tool loop)
  vision_timeout_ms: 15_000,    // 15s
  memory_timeout_ms: 20_000,    // 20s
  health_timeout_ms: 5_000,     // 5s
  retry_attempts: 1,            // one retry on network failure
  retry_delay_ms: 2_000,        // 2s between retries
};

export class ModalError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = "ModalError";
  }
}

interface ModalClientConfig {
  endpointUrl: string;
  authKey: string;
  authSecret: string;
}

/** Max request body size to prevent accidental large payloads (10MB) */
const MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Make an authenticated request to a Modal endpoint.
 * Retries once on network failure. Never retries on 4xx errors.
 */
async function modalFetch<TReq, TRes>(
  config: ModalClientConfig,
  path: string,
  body: TReq,
  timeoutMs: number
): Promise<TRes> {
  // Validate endpoint URL is HTTPS (except in dev)
  if (!config.endpointUrl.startsWith("https://") && !config.endpointUrl.startsWith("http://localhost")) {
    throw new ModalError("Modal endpoint must use HTTPS", 400, path);
  }

  const url = `${config.endpointUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Modal-Key": config.authKey,
    "Modal-Secret": config.authSecret,
  };

  let lastError: Error | null = null;
  const maxAttempts = 1 + MODAL_CONFIG.retry_attempts;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, MODAL_CONFIG.retry_delay_ms));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const serialized = JSON.stringify(body);
      if (serialized.length > MAX_REQUEST_BODY_SIZE) {
        throw new ModalError("Request body too large", 413, path);
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: serialized,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new ModalError(
          `Modal ${path} ${response.status}: ${errorText}`,
          response.status,
          path
        );
      }

      return (await response.json()) as TRes;
    } catch (err) {
      if (err instanceof ModalError && err.status >= 400 && err.status < 500) {
        // Don't retry client errors
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new ModalError("Modal request failed", 500, path);
}

/**
 * Classify intent, complexity, and routing for a user message.
 */
export async function triage(
  config: ModalClientConfig,
  request: ModalTriageRequest
): Promise<ModalTriageResponse> {
  return modalFetch<ModalTriageRequest, ModalTriageResponse>(
    config,
    "/triage",
    request,
    MODAL_CONFIG.triage_timeout_ms
  );
}

/**
 * Run a single round of tool execution.
 * The Worker calls this in a loop, dispatching tool calls between rounds.
 */
export async function execute(
  config: ModalClientConfig,
  request: ModalExecuteRequest
): Promise<ModalExecuteResponse> {
  return modalFetch<ModalExecuteRequest, ModalExecuteResponse>(
    config,
    "/execute",
    request,
    MODAL_CONFIG.execute_timeout_ms
  );
}

/**
 * Process an image through the vision model.
 */
export async function vision(
  config: ModalClientConfig,
  request: ModalVisionRequest
): Promise<ModalVisionResponse> {
  return modalFetch<ModalVisionRequest, ModalVisionResponse>(
    config,
    "/vision",
    request,
    MODAL_CONFIG.vision_timeout_ms
  );
}

/**
 * Extract memory artifacts from a conversation transcript.
 */
export async function extractMemory(
  config: ModalClientConfig,
  request: ModalMemoryExtractionRequest
): Promise<ModalMemoryExtractionResponse> {
  return modalFetch<ModalMemoryExtractionRequest, ModalMemoryExtractionResponse>(
    config,
    "/extract_memory",
    request,
    MODAL_CONFIG.memory_timeout_ms
  );
}

/**
 * Health check — verify the Modal endpoint is alive and models are loaded.
 */
export async function health(
  config: ModalClientConfig
): Promise<ModalHealthResponse> {
  const url = `${config.endpointUrl}/health`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODAL_CONFIG.health_timeout_ms);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Modal-Key": config.authKey,
      "Modal-Secret": config.authSecret,
    },
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new ModalError("Modal health check failed", response.status, "/health");
  }

  return (await response.json()) as ModalHealthResponse;
}

/**
 * Build a ModalClientConfig from CF environment bindings.
 */
export function getModalConfig(env: {
  MODAL_ENDPOINT_URL: string;
  MODAL_AUTH_KEY: string;
  MODAL_AUTH_SECRET: string;
}): ModalClientConfig {
  return {
    endpointUrl: env.MODAL_ENDPOINT_URL,
    authKey: env.MODAL_AUTH_KEY,
    authSecret: env.MODAL_AUTH_SECRET,
  };
}
