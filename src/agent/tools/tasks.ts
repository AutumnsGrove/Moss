/**
 * Task management tools.
 * CRUD operations on moss_tasks in D1.
 */

import type { Env } from "../../shared/env";
import type { ToolResult, Task } from "../../shared/types";
import { generateId, now, parseTags } from "../../shared/utils";

/** Create a new task */
export async function taskCreate(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const title = args.title as string;
  if (!title) return { success: false, error: "title is required" };

  const id = generateId();
  const timestamp = now();
  const tags = args.tags as string[] | undefined;

  await env.DB.prepare(
    `INSERT INTO moss_tasks (id, title, body, status, priority, due_at, remind_at, created_at, updated_at, tags, source)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'telegram')`
  )
    .bind(
      id,
      title,
      (args.body as string) ?? null,
      (args.priority as string) ?? "normal",
      (args.due_at as number) ?? null,
      (args.remind_at as number) ?? null,
      timestamp,
      timestamp,
      tags ? JSON.stringify(tags) : null
    )
    .run();

  return {
    success: true,
    data: { id, title, message: "Task created" },
  };
}

/** List tasks, optionally filtered by status */
export async function taskList(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const status = (args.status as string) ?? "pending";
  const limit = Math.min((args.limit as number) ?? 20, 50);

  let query: string;
  let params: unknown[];

  if (status === "all") {
    query = `SELECT * FROM moss_tasks ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
      due_at ASC NULLS LAST,
      created_at DESC
      LIMIT ?`;
    params = [limit];
  } else {
    query = `SELECT * FROM moss_tasks WHERE status = ? ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
      due_at ASC NULLS LAST,
      created_at DESC
      LIMIT ?`;
    params = [status, limit];
  }

  const result = await env.DB.prepare(query).bind(...params).all<Task>();

  const tasks = (result.results ?? []).map((t) => ({
    ...t,
    tags: parseTags(t.tags as unknown as string | null),
  }));

  return {
    success: true,
    data: { tasks, count: tasks.length },
  };
}

/** Mark a task as done */
export async function taskComplete(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = args.id as string;
  if (!id) return { success: false, error: "id is required" };

  const result = await env.DB.prepare(
    `UPDATE moss_tasks SET status = 'done', updated_at = ? WHERE id = ? AND status != 'done'`
  )
    .bind(now(), id)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return { success: false, error: "Task not found or already done" };
  }

  return { success: true, data: { message: "Task marked as done" } };
}

/** Set a reminder (creates a task with remind_at) */
export async function reminderSet(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const title = args.title as string;
  const remindAt = args.remind_at as number;

  if (!title || !remindAt) {
    return { success: false, error: "title and remind_at are required" };
  }

  const id = generateId();
  const timestamp = now();

  await env.DB.prepare(
    `INSERT INTO moss_tasks (id, title, body, status, priority, due_at, remind_at, created_at, updated_at, tags, source)
     VALUES (?, ?, ?, 'pending', 'normal', ?, ?, ?, ?, NULL, 'telegram')`
  )
    .bind(
      id,
      title,
      (args.body as string) ?? null,
      remindAt,
      remindAt,
      timestamp,
      timestamp
    )
    .run();

  return {
    success: true,
    data: { id, title, remind_at: remindAt, message: "Reminder set" },
  };
}
