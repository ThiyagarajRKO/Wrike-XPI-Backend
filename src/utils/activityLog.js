import { ActivityLog } from "../controllers";

require("dotenv").config();

/**
 * The API/MCP activity log: who called, what they called, whether the
 * security gates let it through, what came back. Written on essentially
 * every authenticated request (src/middlewares/authentication.js's
 * onResponse hook, src/mcp/toolGuard.js per tool call).
 *
 * Two rules that keep this from ever being the thing that breaks a request:
 *
 *   1. Writes are fire-and-forget. `log()` is never awaited by a request
 *      handler — a slow or failing log write must not add latency or cause
 *      a 500 on an otherwise-successful call.
 *   2. Retention is real. This table is written to on every call, so
 *      "keep everything forever" turns into an unbounded table fast. A
 *      background sweep purges rows past ACTIVITY_LOG_RETENTION_DAYS.
 */

const RETENTION_DAYS = (() => {
  const parsed = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
})();

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Fire-and-forget: write one activity row. Never throws, never awaited by a
 * caller — a logging failure is logged to the console and otherwise ignored.
 */
export const log = (entry) => {
  ActivityLog.Record(entry).catch((err) => {
    console.error(
      new Date().toISOString(),
      "[activity-log] write failed:",
      err?.message || err,
    );
  });
};

const sweep = async () => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await ActivityLog.DeleteOlderThan(cutoff);
    if (deleted > 0) {
      console.log(
        new Date().toISOString(),
        `[activity-log] retention sweep: purged ${deleted} row(s) older than ${RETENTION_DAYS}d`,
      );
    }
  } catch (err) {
    console.error(
      new Date().toISOString(),
      "[activity-log] retention sweep failed:",
      err?.message || err,
    );
  }
};

let sweepStarted = false;

/**
 * Starts the periodic retention sweep. Idempotent and self-scheduling (same
 * auto-start-on-load convention as src/utils/redis.js) — call it once from
 * app boot; a second call is a no-op. Runs once shortly after start (so a
 * table that's been growing unattended gets trimmed promptly) and then on
 * SWEEP_INTERVAL_MS after that.
 */
export const startRetentionSweep = () => {
  if (sweepStarted) return;
  sweepStarted = true;

  setTimeout(sweep, 30 * 1000);
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
};

export const retentionDays = () => RETENTION_DAYS;
