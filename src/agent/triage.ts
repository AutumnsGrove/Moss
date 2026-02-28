/**
 * Tier 1 — Triage Layer.
 *
 * Every inbound message hits triage first.
 * Primary: Modal (LFM on your own GPU)
 * Fallback: OpenRouter (LFM2-24B-A2B, degraded mode)
 *
 * Classifies intent, assesses complexity, and decides routing.
 */

import type { Env } from "../shared/env";
import type { TriageResult, MemoryContext } from "../shared/types";
import { triageViaModal, conversationalResponse } from "../shared/providers";
import { formatMemoryForPrompt } from "../shared/memory";
import { getToolNames } from "./tools/index";

const AVAILABLE_TOOLS = [
  "github_issues_list",
  "github_issue_get",
  "github_issue_comment",
  "github_pr_list",
  "github_pr_status",
  "task_create",
  "task_list",
  "task_complete",
  "reminder_set",
  "memory_search",
  "memory_forget",
  "grove_status",
];

/**
 * Run triage on a user message.
 * Routes through Modal first, falls back to OpenRouter.
 */
export async function triageMessage(
  env: Env,
  userMessage: string,
  memory: MemoryContext
): Promise<TriageResult> {
  return triageViaModal(env, userMessage, memory, AVAILABLE_TOOLS);
}

/**
 * Handle simple responses for the chat flow.
 * No tools needed — just a warm, natural response via the conversational model.
 */
export async function handleChatFlow(
  env: Env,
  userMessage: string,
  memory: MemoryContext
): Promise<string> {
  const memorySection = formatMemoryForPrompt(memory);

  const response = await conversationalResponse(env, [
    {
      role: "system",
      content: `You are Moss, a personal AI assistant. Respond conversationally and warmly. Keep it brief.\n\n${memorySection}`,
    },
    { role: "user", content: userMessage },
  ]);

  return response || "Hey, I'm here.";
}
