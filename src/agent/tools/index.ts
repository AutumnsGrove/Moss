/**
 * Tool dispatcher and registry.
 * Routes tool calls to the appropriate handler.
 */

import type { Env } from "../../shared/env";
import type { ToolCall, ToolResult, LLMToolDefinition } from "../../shared/types";
import * as github from "./github";
import * as tasks from "./tasks";
import * as memory from "./memory";
import * as grove from "./grove";

/** All available tool handlers, keyed by tool name */
const TOOL_HANDLERS: Record<
  string,
  (env: Env, args: Record<string, unknown>) => Promise<ToolResult>
> = {
  github_issues_list: github.issuesList,
  github_issue_get: github.issueGet,
  github_issue_comment: github.issueComment,
  github_pr_list: github.prList,
  github_pr_status: github.prStatus,
  task_create: tasks.taskCreate,
  task_list: tasks.taskList,
  task_complete: tasks.taskComplete,
  reminder_set: tasks.reminderSet,
  memory_search: memory.memorySearch,
  memory_forget: memory.memoryForget,
  grove_status: grove.groveStatus,
};

/** Tool definitions for the LLM (OpenAI function calling format) */
const TOOL_DEFINITIONS: Record<string, LLMToolDefinition> = {
  github_issues_list: {
    type: "function",
    function: {
      name: "github_issues_list",
      description: "List open issues in a GitHub repository",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state filter" },
          limit: { type: "number", description: "Max issues to return (default 10)" },
        },
        required: ["repo"],
      },
    },
  },
  github_issue_get: {
    type: "function",
    function: {
      name: "github_issue_get",
      description: "Get details of a specific GitHub issue",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format" },
          number: { type: "number", description: "Issue number" },
        },
        required: ["repo", "number"],
      },
    },
  },
  github_issue_comment: {
    type: "function",
    function: {
      name: "github_issue_comment",
      description: "Add a comment to a GitHub issue (requires confirmation)",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format" },
          number: { type: "number", description: "Issue number" },
          body: { type: "string", description: "Comment text" },
        },
        required: ["repo", "number", "body"],
      },
    },
  },
  github_pr_list: {
    type: "function",
    function: {
      name: "github_pr_list",
      description: "List open pull requests in a GitHub repository",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "PR state filter" },
          limit: { type: "number", description: "Max PRs to return (default 10)" },
        },
        required: ["repo"],
      },
    },
  },
  github_pr_status: {
    type: "function",
    function: {
      name: "github_pr_status",
      description: "Get CI status for a pull request",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository in owner/name format" },
          number: { type: "number", description: "PR number" },
        },
        required: ["repo", "number"],
      },
    },
  },
  task_create: {
    type: "function",
    function: {
      name: "task_create",
      description: "Create a new task with optional due date and reminder",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          body: { type: "string", description: "Full context or original message" },
          priority: { type: "string", enum: ["low", "normal", "high"], description: "Task priority" },
          due_at: { type: "number", description: "Unix timestamp for due date" },
          remind_at: { type: "number", description: "Unix timestamp for reminder" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        },
        required: ["title"],
      },
    },
  },
  task_list: {
    type: "function",
    function: {
      name: "task_list",
      description: "List pending tasks, optionally filtered by status or tags",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "snoozed", "done", "cancelled", "all"], description: "Filter by status" },
          limit: { type: "number", description: "Max tasks to return (default 20)" },
        },
      },
    },
  },
  task_complete: {
    type: "function",
    function: {
      name: "task_complete",
      description: "Mark a task as done",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID" },
        },
        required: ["id"],
      },
    },
  },
  reminder_set: {
    type: "function",
    function: {
      name: "reminder_set",
      description: "Set a timed reminder for a task or freeform note",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to remind about" },
          remind_at: { type: "number", description: "Unix timestamp for when to remind" },
          body: { type: "string", description: "Additional context" },
        },
        required: ["title", "remind_at"],
      },
    },
  },
  memory_search: {
    type: "function",
    function: {
      name: "memory_search",
      description: "Search stored facts and episodes for relevant information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  memory_forget: {
    type: "function",
    function: {
      name: "memory_forget",
      description: "Mark a stored fact as deleted (requires confirmation)",
      parameters: {
        type: "object",
        properties: {
          fact_id: { type: "string", description: "ID of the fact to forget" },
        },
        required: ["fact_id"],
      },
    },
  },
  grove_status: {
    type: "function",
    function: {
      name: "grove_status",
      description: "Check the health status of Grove services",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Specific service to check (or 'all')" },
        },
      },
    },
  },
};

/**
 * Get LLM tool definitions filtered to what the triage layer says is needed.
 * If no specific tools requested, return all definitions.
 */
export function getToolDefinitionsForLLM(
  toolsNeeded: string[]
): LLMToolDefinition[] {
  if (toolsNeeded.length === 0) {
    return Object.values(TOOL_DEFINITIONS);
  }

  return toolsNeeded
    .map((name) => TOOL_DEFINITIONS[name])
    .filter((def): def is LLMToolDefinition => def !== undefined);
}

/**
 * Dispatch a tool call to the appropriate handler.
 */
export async function dispatchTool(
  env: Env,
  call: ToolCall
): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[call.name];

  if (!handler) {
    return {
      success: false,
      error: `Unknown tool: ${call.name}`,
    };
  }

  try {
    return await handler(env, call.arguments);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return { success: false, error: message };
  }
}
