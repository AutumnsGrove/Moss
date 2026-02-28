/**
 * moss-scheduler: Cron-triggered worker for reminders and daily digests.
 *
 * Cron schedules (defined in wrangler.toml):
 * - 9am ET daily: Full digest of pending tasks
 * - Every 15 min during waking hours: Check for due reminders
 */

import type { Env } from "../shared/env";
import { logError } from "../shared/utils";
import { checkAndDeliverReminders, sendDailyDigest } from "./reminders";

/**
 * Handle a scheduled (cron) event.
 * Distinguishes between the daily digest and frequent reminder checks.
 */
export async function handleScheduledEvent(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  try {
    // Determine if this is the daily digest or a reminder check
    // The daily digest fires at 13:00 UTC (9am ET during EDT)
    const eventDate = new Date(event.scheduledTime);
    const hour = eventDate.getUTCHours();
    const minute = eventDate.getUTCMinutes();

    const isDailyDigest = hour === 13 && minute === 0;

    if (isDailyDigest) {
      await sendDailyDigest(env);
    } else {
      await checkAndDeliverReminders(env);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown scheduler error";
    await logError(env.DB, message, "scheduler");
  }
}
