/** Local run state (.sdd/run.json) checks, kept free of I/O so they are unit-testable. */

/**
 * Why the recorded run cannot be used for `taskKey`, or null when it can.
 * An old run.json without task_key is accepted (nothing to compare against).
 */
export function runTaskMismatch(recordedKey: string | undefined | null, taskKey: string | undefined | null): string | null {
  if (!taskKey || !recordedKey) return null;
  if (recordedKey.trim().toUpperCase() === taskKey.trim().toUpperCase()) return null;
  return `The active run in .sdd/run.json belongs to ${recordedKey.toUpperCase()}, not ${taskKey.toUpperCase()}. Finish or block ${recordedKey.toUpperCase()} first, or claim ${taskKey.toUpperCase()} to start a run for it.`;
}
