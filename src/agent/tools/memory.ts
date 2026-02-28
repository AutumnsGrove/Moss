/**
 * Memory tools — search facts/episodes, forget facts.
 */

import type { Env } from "../../shared/env";
import type { ToolResult, Fact, Episode } from "../../shared/types";
import { now } from "../../shared/utils";

/** Search stored facts and episodes by keyword */
export async function memorySearch(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = args.query as string;
  if (!query) return { success: false, error: "query is required" };

  const limit = Math.min((args.limit as number) ?? 10, 30);

  // Search facts using LIKE (until Vectorize is provisioned for semantic search)
  const searchPattern = `%${query}%`;

  const [factsResult, episodesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, content, confidence, created_at, updated_at, source
       FROM moss_facts
       WHERE deleted_at IS NULL AND content LIKE ?
       ORDER BY updated_at DESC
       LIMIT ?`
    )
      .bind(searchPattern, limit)
      .all<Fact>(),

    env.DB.prepare(
      `SELECT id, summary, mood_signal, created_at
       FROM moss_episodes
       WHERE deleted_at IS NULL AND summary LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(searchPattern, limit)
      .all<Episode>(),
  ]);

  return {
    success: true,
    data: {
      facts: factsResult.results ?? [],
      episodes: episodesResult.results ?? [],
      note: "Using keyword search. Semantic search available when Vectorize is provisioned.",
    },
  };
}

/** Soft-delete a stored fact (WRITE operation — requires confirmation in agent) */
export async function memoryForget(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const factId = args.fact_id as string;
  if (!factId) return { success: false, error: "fact_id is required" };

  const result = await env.DB.prepare(
    `UPDATE moss_facts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(now(), factId)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return { success: false, error: "Fact not found or already deleted" };
  }

  return { success: true, data: { message: "Fact forgotten" } };
}
