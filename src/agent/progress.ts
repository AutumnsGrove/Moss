/**
 * Progress log — real-time observability via Telegram message editing.
 *
 * For work-flow interactions, the user sees a live progress log that grows
 * as each tool completes. Uses Telegram's editMessageText API with HTML formatting.
 *
 * Example:
 *   <b>▸ Triage:</b> github_board_check
 *   <b>▸ github_issues_list</b> → <i>12 items</i>
 *   <b>▸ github_pr_status</b> → <i>2 open, 1 failing CI</i>
 *   <b>✓ Done</b> (1.3s)
 */

import type { ProgressEntry } from "../shared/types";
import { sendMessageWithId, editMessageText } from "../shared/telegram";

export interface ProgressLog {
  chatId: number;
  messageId: number | null;
  entries: string[];
  startTime: number;
}

/**
 * Create a new progress log. Sends the initial message to Telegram.
 */
export async function createProgressLog(
  token: string,
  chatId: number,
  triageIntent: string
): Promise<ProgressLog> {
  const initialText = `<b>▸ Triage:</b> ${escapeHtml(triageIntent)}`;

  const result = await sendMessageWithId(token, {
    chatId,
    text: initialText,
    parseMode: "HTML",
  });

  return {
    chatId,
    messageId: result.message_id ?? null,
    entries: [initialText],
    startTime: Date.now(),
  };
}

/**
 * Append an entry to the progress log and update the Telegram message.
 */
export async function appendProgressEntry(
  token: string,
  log: ProgressLog,
  entry: ProgressEntry
): Promise<ProgressLog> {
  const line = formatProgressLine(entry);
  const updatedEntries = [...log.entries, line];
  const fullText = updatedEntries.join("\n");

  if (log.messageId) {
    await editMessageText(token, {
      chatId: log.chatId,
      messageId: log.messageId,
      text: fullText,
      parseMode: "HTML",
    });
  }

  return { ...log, entries: updatedEntries };
}

/**
 * Finalize the progress log with a "Done" entry showing total duration.
 */
export async function finalizeProgressLog(
  token: string,
  log: ProgressLog
): Promise<void> {
  const durationMs = Date.now() - log.startTime;
  const durationStr = (durationMs / 1000).toFixed(1);
  const doneLine = `<b>✓ Done</b> (${durationStr}s)`;

  const updatedEntries = [...log.entries, doneLine];
  const fullText = updatedEntries.join("\n");

  if (log.messageId) {
    await editMessageText(token, {
      chatId: log.chatId,
      messageId: log.messageId,
      text: fullText,
      parseMode: "HTML",
    });
  }
}

/**
 * Format a single progress entry as an HTML line.
 */
function formatProgressLine(entry: ProgressEntry): string {
  switch (entry.type) {
    case "tool_call":
      return `<b>▸ ${escapeHtml(entry.tool_name ?? "unknown")}</b>`;

    case "tool_result":
      if (entry.result_summary) {
        return `<b>▸ ${escapeHtml(entry.tool_name ?? "unknown")}</b> → <i>${escapeHtml(entry.result_summary)}</i>`;
      }
      return `<b>▸ ${escapeHtml(entry.tool_name ?? "unknown")}</b> → <i>done</i>`;

    case "error":
      return `<b>✗ ${escapeHtml(entry.tool_name ?? "error")}</b> → <i>${escapeHtml(entry.error_message ?? "failed")}</i>`;

    case "done": {
      const duration = entry.duration_ms
        ? ` (${(entry.duration_ms / 1000).toFixed(1)}s)`
        : "";
      return `<b>✓ Done</b>${duration}`;
    }

    default:
      return `<b>▸</b> ${escapeHtml(entry.tool_name ?? "")}`;
  }
}

/**
 * Escape HTML special characters for Telegram HTML formatting.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Summarize a tool result for the progress log.
 * Keeps it concise — one line, no raw data dumps.
 */
export function summarizeToolResult(
  toolName: string,
  result: { success: boolean; data?: unknown; error?: string }
): string {
  if (!result.success) {
    return result.error ?? "failed";
  }

  const data = result.data;
  if (data === null || data === undefined) return "done";

  // Handle arrays (common for list operations)
  if (Array.isArray(data)) {
    return `${data.length} item${data.length === 1 ? "" : "s"}`;
  }

  // Handle objects with a message or status
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.status === "string") return obj.status;
    if (typeof obj.title === "string") return obj.title;
  }

  // Handle primitives
  if (typeof data === "string") {
    return data.length > 60 ? data.slice(0, 57) + "..." : data;
  }

  return "done";
}
