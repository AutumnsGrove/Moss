/**
 * Reminder query and delivery logic.
 * Called by the cron handler to check for due reminders and send them.
 */

import type { Env } from "../shared/env";
import type { Task } from "../shared/types";
import { sendMessage } from "../shared/telegram";
import { now, formatTimestamp, parseTags, truncate } from "../shared/utils";

/**
 * Check for due reminders and deliver them via Telegram.
 * Called by the cron trigger handler.
 */
export async function checkAndDeliverReminders(env: Env): Promise<number> {
  const currentTime = now();
  const ownerChatId = parseInt(env.OWNER_TELEGRAM_ID, 10);

  // Find tasks where remind_at has passed and status is still pending
  const result = await env.DB.prepare(
    `SELECT id, title, body, priority, due_at, remind_at, tags
     FROM moss_tasks
     WHERE status = 'pending'
       AND remind_at IS NOT NULL
       AND remind_at <= ?
     ORDER BY priority DESC, remind_at ASC
     LIMIT 10`
  )
    .bind(currentTime)
    .all<Task>();

  const tasks = result.results ?? [];
  if (tasks.length === 0) return 0;

  // Single task → direct message. Multiple → digest format.
  if (tasks.length === 1) {
    const task = tasks[0];
    await deliverSingleReminder(env, ownerChatId, task);
  } else {
    await deliverDigest(env, ownerChatId, tasks);
  }

  // Clear remind_at so we don't re-send (unless it's recurring, which v1 doesn't support)
  const ids = tasks.map((t) => t.id);
  for (const id of ids) {
    await env.DB.prepare(
      `UPDATE moss_tasks SET remind_at = NULL, updated_at = ? WHERE id = ?`
    )
      .bind(currentTime, id)
      .run();
  }

  return tasks.length;
}

/** Send a single reminder as a conversational message */
async function deliverSingleReminder(
  env: Env,
  chatId: number,
  task: Task
): Promise<void> {
  const priority =
    task.priority === "high" ? " (high priority)" : "";
  const due = task.due_at
    ? ` It's due ${formatTimestamp(task.due_at)}.`
    : "";

  const text = `Hey — you wanted a reminder about: ${task.title}${priority}${due}`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, { chatId, text });
}

/** Send a digest of multiple reminders */
async function deliverDigest(
  env: Env,
  chatId: number,
  tasks: Task[]
): Promise<void> {
  const lines = tasks.map((t) => {
    const priority = t.priority === "high" ? " !" : "";
    const tags = parseTags(t.tags as unknown as string | null);
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    return `• ${t.title}${priority}${tagStr}`;
  });

  const text = `Morning — here's what's on your plate:\n\n${lines.join("\n")}`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, { chatId, text });
}

/**
 * Build and send the daily digest.
 * Summarizes pending tasks, upcoming due dates, and any overdue items.
 */
export async function sendDailyDigest(env: Env): Promise<void> {
  const ownerChatId = parseInt(env.OWNER_TELEGRAM_ID, 10);
  const currentTime = now();

  // Get all pending tasks
  const result = await env.DB.prepare(
    `SELECT id, title, priority, due_at, tags
     FROM moss_tasks
     WHERE status = 'pending'
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
       due_at ASC NULLS LAST
     LIMIT 20`
  ).all<Task>();

  const tasks = result.results ?? [];

  if (tasks.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId: ownerChatId,
      text: "Good morning — your task list is clear. Nice.",
    });
    return;
  }

  const overdue = tasks.filter((t) => t.due_at && t.due_at < currentTime);
  const dueToday = tasks.filter((t) => {
    if (!t.due_at) return false;
    const endOfDay = currentTime - (currentTime % 86400) + 86400;
    return t.due_at >= currentTime && t.due_at < endOfDay;
  });
  const other = tasks.filter(
    (t) => !overdue.includes(t) && !dueToday.includes(t)
  );

  const parts: string[] = ["Good morning — here's where things stand:"];

  if (overdue.length > 0) {
    parts.push(
      "\nOverdue:\n" + overdue.map((t) => `• ${t.title}`).join("\n")
    );
  }

  if (dueToday.length > 0) {
    parts.push(
      "\nDue today:\n" + dueToday.map((t) => `• ${t.title}`).join("\n")
    );
  }

  if (other.length > 0) {
    parts.push(
      "\nPending:\n" +
        other
          .slice(0, 10)
          .map((t) => `• ${t.title}`)
          .join("\n")
    );
    if (other.length > 10) {
      parts.push(`...and ${other.length - 10} more`);
    }
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, {
    chatId: ownerChatId,
    text: truncate(parts.join("\n"), 4000),
  });
}
