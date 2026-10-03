import { CliError } from "@sdd/cli/lib/api";

/** When the daemon asks for work again while idle, and which heartbeat failures mean a run is no longer ours. */

/** Idle polling of dispatch-next: first retry, and the backoff ceiling. */
export const IDLE_POLL_MIN_MS = 15_000;
export const IDLE_POLL_MAX_MS = 5 * 60_000;
/** Idle backoff for dispatch-next polling: 15 s, 30 s, … capped at 5 min. */
export function nextIdlePollDelay(previousMs: number | null): number {
  if (!previousMs || previousMs < IDLE_POLL_MIN_MS) return IDLE_POLL_MIN_MS;
  return Math.min(previousMs * 2, IDLE_POLL_MAX_MS);
}

/** A heartbeat failure that means this run no longer belongs to us: stop it. */
export function isRunOwnershipLost(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  if (error.code.startsWith("LEASE_") || error.code === "RUN_NOT_FOUND") return true;
  return error.httpStatus === 403 || error.httpStatus === 404 || error.httpStatus === 409;
}
