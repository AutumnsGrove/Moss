/**
 * Shared utilities for Moss workers.
 */

/** Generate a unique ID using crypto.randomUUID() */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Current Unix timestamp in seconds */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Truncate text to a max length, adding ellipsis if needed */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/** Safely parse JSON, returning null on failure */
export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Log an error to D1 moss_errors table (never exposed to Telegram) */
export async function logError(
  db: D1Database,
  error: string,
  context?: string
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO moss_errors (id, error, context, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(generateId(), truncate(error, 2000), context ?? null, now())
      .run();
  } catch {
    // If we can't even log the error, there's nothing more we can do.
    // The Worker will exit and CF will log the unhandled error.
  }
}

/**
 * Wrap external content in tags to mitigate prompt injection.
 * All content from GitHub, skills, or any external source MUST pass through this.
 */
export function wrapExternalContent(content: string, source: string): string {
  return `<external_content source="${source}">\n${content}\n</external_content>`;
}

/** Format a Unix timestamp as a human-readable date string */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Parse tags from a JSON string, returning empty array on failure */
export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  return safeJsonParse<string[]>(tagsJson) ?? [];
}
