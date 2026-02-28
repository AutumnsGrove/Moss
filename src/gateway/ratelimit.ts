/**
 * Rate limiting using KV.
 * Simple sliding window counter — sufficient for a single-user bot.
 *
 * Future: Replace with Threshold via Lattice SDK when available.
 */

const RATE_LIMIT_PREFIX = "moss:ratelimit:";
const MAX_MESSAGES_PER_HOUR = 60;
const WINDOW_SECONDS = 3600;

/**
 * Check if a sender is within rate limits.
 * Uses KV with TTL for automatic expiry.
 * Returns true if the request is allowed, false if rate limited.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  senderId: string
): Promise<boolean> {
  const key = `${RATE_LIMIT_PREFIX}${senderId}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= MAX_MESSAGES_PER_HOUR) {
    return false;
  }

  // Increment counter with TTL
  await kv.put(key, String(count + 1), {
    expirationTtl: WINDOW_SECONDS,
  });

  return true;
}
