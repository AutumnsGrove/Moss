/**
 * Provider abstraction layer.
 * Routes inference requests to Modal (worker models) or OpenRouter (conversational).
 *
 * Modal handles: triage, tool execution, memory extraction, vision.
 * OpenRouter handles: acknowledgments, final responses, pure chat.
 *
 * If Modal is unavailable, falls back to OpenRouter for everything (degraded mode).
 */

import type { Env } from "./env";
import type {
  TriageResult,
  MemoryContext,
  ChatMessage,
  LLMToolDefinition,
  ModalTriageRequest,
  ModalExecuteRequest,
  ModalExecuteResponse,
  ModalToolResult,
  ModalVisionRequest,
  ModalVisionResponse,
  ModalMemoryExtractionRequest,
  ModalMemoryExtractionResponse,
} from "./types";
import * as modal from "./modal";
import { getModalConfig } from "./modal";
import { chatCompletion, selectExecutionModel, Models } from "./openrouter";
import { formatMemoryForPrompt } from "./memory";
import { safeJsonParse } from "./utils";

const MODEL_PREFERENCE_KEY = "moss:config:conversational-model";

/**
 * Run triage via Modal. Falls back to OpenRouter if Modal is down.
 */
export async function triageViaModal(
  env: Env,
  userMessage: string,
  memory: MemoryContext,
  availableTools: string[]
): Promise<TriageResult> {
  try {
    const config = getModalConfig(env);
    const memorySection = formatMemoryForPrompt(memory);

    const request: ModalTriageRequest = {
      message: userMessage,
      memory_context: memorySection,
      available_tools: availableTools,
      conversation_history: [],
    };

    const response = await modal.triage(config, request);

    return {
      intent: response.intent as TriageResult["intent"],
      complexity: response.complexity as TriageResult["complexity"],
      tools_needed: response.tools_needed,
      route_to: response.route_to as TriageResult["route_to"],
      confidence: response.confidence,
    };
  } catch {
    // Modal unavailable — fall back to OpenRouter triage (degraded mode)
    return triageFallback(env, userMessage, memory);
  }
}

/**
 * OpenRouter fallback for triage when Modal is unavailable.
 */
async function triageFallback(
  env: Env,
  userMessage: string,
  memory: MemoryContext
): Promise<TriageResult> {
  const memorySection = formatMemoryForPrompt(memory);

  const FALLBACK_TRIAGE_PROMPT = `You are Moss's routing layer. Classify the user's message and decide how to handle it.

Respond with ONLY a JSON object — no explanation, no markdown, no extra text.

JSON schema:
{
  "intent": "task_create" | "task_query" | "github" | "memory_query" | "conversation" | "reminder_set" | "skill_invoke" | "memory_manage" | "grove_status",
  "complexity": "simple" | "moderate" | "complex",
  "tools_needed": string[],
  "route_to": "simple_response" | "full_agent" | "queue_async",
  "confidence": number (0-1)
}

Routing rules:
- Greetings, simple questions about the owner -> simple_response
- Task creation, reminders, GitHub lookups, memory queries -> full_agent
- When uncertain, default to full_agent`;

  try {
    const response = await chatCompletion(env.OPENROUTER_API_KEY, {
      model: Models.TRIAGE,
      messages: [
        { role: "system", content: FALLBACK_TRIAGE_PROMPT },
        { role: "system", content: `Context about the owner:\n${memorySection}` },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 256,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return defaultTriage();

    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const result = safeJsonParse<TriageResult>(jsonStr);
    if (!result || !result.intent) return defaultTriage();
    return result;
  } catch {
    return defaultTriage();
  }
}

function defaultTriage(): TriageResult {
  return {
    intent: "conversation",
    complexity: "moderate",
    tools_needed: [],
    route_to: "full_agent",
    confidence: 0.5,
  };
}

/**
 * Run a single executor round via Modal.
 * Returns tool calls to dispatch, or a done signal with summary.
 */
export async function executeRoundViaModal(
  env: Env,
  userMessage: string,
  triage: TriageResult,
  memory: MemoryContext,
  tools: LLMToolDefinition[],
  toolResults: ModalToolResult[],
  roundNumber: number
): Promise<ModalExecuteResponse> {
  const config = getModalConfig(env);
  const memorySection = formatMemoryForPrompt(memory);

  const request: ModalExecuteRequest = {
    message: userMessage,
    triage,
    memory_context: memorySection,
    tools,
    tool_results: toolResults,
    round_number: roundNumber,
  };

  return modal.execute(config, request);
}

/**
 * Process an image through Modal's vision pipeline.
 */
export async function visionViaModal(
  env: Env,
  imageBase64: string,
  caption: string,
  memory: MemoryContext
): Promise<ModalVisionResponse> {
  const config = getModalConfig(env);
  const memorySection = formatMemoryForPrompt(memory);

  const request: ModalVisionRequest = {
    image_base64: imageBase64,
    caption,
    memory_context: memorySection,
  };

  return modal.vision(config, request);
}

/**
 * Extract memory via Modal. Falls back to OpenRouter if Modal is down.
 */
export async function extractMemoryViaModal(
  env: Env,
  transcript: string
): Promise<ModalMemoryExtractionResponse> {
  try {
    const config = getModalConfig(env);
    const request: ModalMemoryExtractionRequest = { transcript };
    return await modal.extractMemory(config, request);
  } catch {
    // Fallback: return empty extraction rather than losing the conversation
    return {
      facts: [],
      episode_summary: "",
      mood_signal: null,
      core_block_updates: [],
    };
  }
}

/**
 * Generate a conversational response via OpenRouter.
 * Used for: acknowledgments, final responses, pure chat, error explanations.
 */
export async function conversationalResponse(
  env: Env,
  messages: ChatMessage[]
): Promise<string> {
  const model = await getConversationalModel(env.KV);

  const response = await chatCompletion(env.OPENROUTER_API_KEY, {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 2048,
  });

  return response.choices[0]?.message?.content ?? "";
}

/**
 * Get the user's preferred conversational model from KV.
 * Defaults to MiniMax M2.5.
 */
async function getConversationalModel(
  kv: KVNamespace
): Promise<typeof Models[keyof typeof Models]> {
  const stored = await kv.get(MODEL_PREFERENCE_KEY);
  if (!stored) return Models.MINIMAX;

  // Validate stored model is one we support
  const validModels = Object.values(Models);
  if (validModels.includes(stored as typeof Models[keyof typeof Models])) {
    return stored as typeof Models[keyof typeof Models];
  }

  return Models.MINIMAX;
}

/**
 * Set the user's preferred conversational model.
 */
export async function setConversationalModel(
  kv: KVNamespace,
  modelAlias: string
): Promise<{ model: string; display: string } | null> {
  const aliases: Record<string, { model: typeof Models[keyof typeof Models]; display: string }> = {
    minimax: { model: Models.MINIMAX, display: "MiniMax M2.5" },
    claude: { model: Models.CLAUDE_SONNET, display: "Claude Sonnet" },
    kimi: { model: Models.KIMI, display: "Kimi K2.5" },
  };

  const alias = modelAlias.toLowerCase().trim();
  const match = aliases[alias];
  if (!match) return null;

  await kv.put(MODEL_PREFERENCE_KEY, match.model);
  return { model: match.model, display: match.display };
}

/**
 * Get the current conversational model name for display.
 */
export async function getCurrentModelDisplay(kv: KVNamespace): Promise<string> {
  const model = await getConversationalModel(kv);
  const displays: Record<string, string> = {
    [Models.MINIMAX]: "MiniMax M2.5",
    [Models.CLAUDE_SONNET]: "Claude Sonnet",
    [Models.KIMI]: "Kimi K2.5",
  };
  return displays[model] ?? model;
}
