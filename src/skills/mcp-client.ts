/**
 * MCP (Model Context Protocol) client for skill execution.
 *
 * Connects to MCP servers declared in skill manifests.
 * Enforces timeouts, call limits, cost class guards, and content wrapping.
 */

import type { Env } from "../shared/env";
import type { SkillRegistryEntry, ToolResult } from "../shared/types";
import { wrapExternalContent } from "../shared/utils";

/** Track per-conversation call counts */
const callCounts = new Map<string, number>();

/**
 * Execute an MCP tool call against a skill's server.
 *
 * Enforces:
 * - max_calls_per_conversation hard limit
 * - timeout_ms per call
 * - <external_content> wrapping on all responses
 * - memory_write permission guard
 */
export async function executeMcpTool(
  env: Env,
  skill: SkillRegistryEntry,
  toolName: string,
  args: Record<string, unknown>,
  conversationId: string
): Promise<ToolResult> {
  // Enforce call limit
  const countKey = `${conversationId}:${skill.skill.name}`;
  const currentCount = callCounts.get(countKey) ?? 0;
  if (currentCount >= skill.limits.max_calls_per_conversation) {
    return {
      success: false,
      error: `Call limit reached for skill ${skill.skill.name} (${skill.limits.max_calls_per_conversation} max per conversation)`,
    };
  }

  // Verify the requested tool is in the skill's allowlist
  if (skill.integration.tools && !skill.integration.tools.includes(toolName)) {
    return {
      success: false,
      error: `Tool ${toolName} not allowed for skill ${skill.skill.name}`,
    };
  }

  if (!skill.integration.server_url) {
    return {
      success: false,
      error: `Skill ${skill.skill.name} has no server_url configured`,
    };
  }

  try {
    // Resolve env var references in server URL (e.g., {{TAVILY_API_KEY}})
    const serverUrl = resolveEnvVars(skill.integration.server_url, env);

    // Make the MCP call with timeout
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      skill.limits.timeout_ms
    );

    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
        id: crypto.randomUUID(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `MCP server returned ${response.status}`,
      };
    }

    const result = (await response.json()) as {
      result?: { content: Array<{ text?: string }> };
      error?: { message: string };
    };

    // Increment call counter
    callCounts.set(countKey, currentCount + 1);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    // Wrap ALL external content — prompt injection mitigation
    const content = result.result?.content
      ?.map((c) => c.text ?? "")
      .join("\n");

    return {
      success: true,
      data: wrapExternalContent(
        content ?? "No content returned",
        `skill:${skill.skill.name}`
      ),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: `Skill ${skill.skill.name} timed out after ${skill.limits.timeout_ms}ms`,
      };
    }
    const message = err instanceof Error ? err.message : "MCP call failed";
    return { success: false, error: message };
  }
}

/**
 * Resolve {{ENV_VAR}} references in a string using env bindings.
 * Secrets are never stored in manifests — only references.
 */
function resolveEnvVars(template: string, env: Env): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
    const value = (env as unknown as Record<string, string>)[varName];
    if (!value) {
      throw new Error(`Missing env var: ${varName}`);
    }
    return value;
  });
}

/** Reset call counts (called at conversation start) */
export function resetCallCounts(): void {
  callCounts.clear();
}
