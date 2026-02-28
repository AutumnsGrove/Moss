/**
 * Memory retrieval helpers.
 * Loads Core Blocks, recent episodes, and relevant facts into context
 * for every conversation.
 */

import type { Env } from "./env";
import type { Episode, Fact, MemoryContext } from "./types";

const CORE_BLOCKS_KEY = "moss:core-blocks";
const MAX_RECENT_EPISODES = 5;
const MAX_RELEVANT_FACTS = 15;

/**
 * Build the full memory context for a conversation.
 * Injected at the top of every system prompt.
 */
export async function buildMemoryContext(
  env: Env,
  _userMessage?: string
): Promise<MemoryContext> {
  const [coreBlocks, recentEpisodes, relevantFacts] = await Promise.all([
    loadCoreBlocks(env.KV),
    loadRecentEpisodes(env.DB),
    // Semantic search requires Vectorize (not yet provisioned).
    // For now, load most recent facts as a fallback.
    loadRecentFacts(env.DB),
  ]);

  return {
    core_blocks: coreBlocks,
    recent_episodes: recentEpisodes,
    relevant_facts: relevantFacts,
  };
}

/** Load Core Blocks from KV — always injected, always available */
async function loadCoreBlocks(kv: KVNamespace): Promise<string> {
  const blocks = await kv.get(CORE_BLOCKS_KEY);
  return blocks ?? "# Core Blocks not yet configured";
}

/** Load the N most recent episodes from D1 */
async function loadRecentEpisodes(db: D1Database): Promise<Episode[]> {
  const result = await db
    .prepare(
      `SELECT id, summary, mood_signal, embedding_id, created_at, deleted_at
       FROM moss_episodes
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(MAX_RECENT_EPISODES)
    .all<Episode>();

  return result.results ?? [];
}

/** Load recent facts from D1 (fallback until Vectorize is provisioned) */
async function loadRecentFacts(db: D1Database): Promise<Fact[]> {
  const result = await db
    .prepare(
      `SELECT id, content, confidence, embedding_id, created_at, updated_at, deleted_at, source
       FROM moss_facts
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(MAX_RELEVANT_FACTS)
    .all<Fact>();

  return result.results ?? [];
}

/**
 * Format memory context into a system prompt section.
 */
export function formatMemoryForPrompt(memory: MemoryContext): string {
  const parts: string[] = [];

  // Core Blocks — always first
  parts.push("# About the Owner\n" + memory.core_blocks);

  // Recent episodes
  if (memory.recent_episodes.length > 0) {
    parts.push(
      "# Recent Conversations\n" +
        memory.recent_episodes
          .map((ep) => {
            const mood = ep.mood_signal ? ` (mood: ${ep.mood_signal})` : "";
            return `- ${ep.summary}${mood}`;
          })
          .join("\n")
    );
  }

  // Relevant facts
  if (memory.relevant_facts.length > 0) {
    parts.push(
      "# Known Facts & Preferences\n" +
        memory.relevant_facts
          .map((f) => `- ${f.content} [${f.confidence}]`)
          .join("\n")
    );
  }

  return parts.join("\n\n");
}
