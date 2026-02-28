/**
 * Tier 1 — LFM2-24B-A2B Router/Triage.
 * Every inbound message hits this model first.
 * Classifies intent, assesses complexity, and decides routing.
 */

import type { Env } from "../shared/env";
import type { TriageResult, MemoryContext } from "../shared/types";
import { chatCompletion, Models } from "../shared/openrouter";
import { formatMemoryForPrompt } from "../shared/memory";
import { safeJsonParse } from "../shared/utils";

const TRIAGE_SYSTEM_PROMPT = `You are Moss's routing layer. Your job is to classify the user's message and decide how to handle it.

You MUST respond with ONLY a JSON object — no explanation, no markdown, no extra text.

JSON schema:
{
  "intent": "task_create" | "task_query" | "github" | "memory_query" | "conversation" | "reminder_set" | "skill_invoke" | "memory_manage" | "grove_status",
  "complexity": "simple" | "moderate" | "complex",
  "tools_needed": string[],
  "route_to": "simple_response" | "full_agent" | "queue_async",
  "confidence": number (0-1)
}

Routing rules:
- Greetings, simple questions about the owner → simple_response (you handle it)
- Task creation, reminders, GitHub lookups, memory queries → full_agent
- Multi-step reasoning, research, complex analysis → queue_async
- When uncertain, default to full_agent

Tools available: github_issues_list, github_issue_get, github_issue_comment, github_pr_list, github_pr_status, task_create, task_list, task_complete, reminder_set, memory_search, memory_forget, grove_status`;

const DEFAULT_TRIAGE: TriageResult = {
  intent: "conversation",
  complexity: "moderate",
  tools_needed: [],
  route_to: "full_agent",
  confidence: 0.5,
};

/**
 * Run Tier 1 triage on a user message.
 * Returns a structured routing decision.
 */
export async function triageMessage(
  env: Env,
  userMessage: string,
  memory: MemoryContext
): Promise<TriageResult> {
  try {
    const memorySection = formatMemoryForPrompt(memory);

    const response = await chatCompletion(env.OPENROUTER_API_KEY, {
      model: Models.TRIAGE,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        {
          role: "system",
          content: `Current context about the owner:\n${memorySection}`,
        },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 256,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return DEFAULT_TRIAGE;

    // Extract JSON from response (LFM may wrap it in markdown code blocks)
    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const result = safeJsonParse<TriageResult>(jsonStr);

    if (!result || !result.intent || !result.route_to) {
      return DEFAULT_TRIAGE;
    }

    return result;
  } catch {
    // If triage fails, default to full_agent — better to over-process than drop
    return DEFAULT_TRIAGE;
  }
}

/**
 * Handle simple responses directly from the triage layer.
 * Used for greetings, quick lookups, etc. where Tier 2 isn't needed.
 */
export async function handleSimpleResponse(
  env: Env,
  userMessage: string,
  memory: MemoryContext
): Promise<string> {
  const memorySection = formatMemoryForPrompt(memory);

  const response = await chatCompletion(env.OPENROUTER_API_KEY, {
    model: Models.TRIAGE,
    messages: [
      {
        role: "system",
        content: `You are Moss, a personal AI assistant. Respond conversationally and warmly. Keep it brief.

${memorySection}`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 512,
  });

  return response.choices[0]?.message?.content ?? "Hey, I'm here.";
}
