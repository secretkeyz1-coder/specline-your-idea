import type { JourneyAction } from "./journey.js";

/**
 * The paid AI generation started from a next-step bar, per project. Several
 * bars can be on screen at once (the Plan page's panel and the inline bar in
 * the project header), and each used to keep its own busy flag: pressing
 * Generate in both started two paid runs. This state is shared by all of them,
 * so while one run is in flight every bar of that project shows it and
 * disables the action.
 *
 * Only ever written in the browser (form submit handlers), so the module-level
 * state is never shared between server requests.
 */
export type GenerationRun = {
  /** In flight: the action and the page (path + query) it was started from. */
  running: { action: JourneyAction; from: string } | null;
  /** The last run's failure, shown by every bar until the next attempt. */
  error: string | null;
  /** A run that finished while the user was on another page: offer the result. */
  done: { action: JourneyAction } | null;
};

export const generation = $state<Record<string, GenerationRun>>({});

export function runOf(projectId: string): GenerationRun {
  return generation[projectId] ?? { running: null, error: null, done: null };
}

export function setRun(projectId: string, patch: Partial<GenerationRun>): void {
  generation[projectId] = { ...runOf(projectId), ...patch };
}
