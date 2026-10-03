import { newTraceId } from "@sdd/shared";

/**
 * In-process realtime bus. Browser clients subscribe via SSE (docs/07 §8);
 * events are invalidation hints — clients re-fetch authoritative state
 * (docs/09 §23). Writes always go through command services first.
 */

export interface RealtimeEvent {
  topic: string; // e.g. `project:${projectId}` or `task:${taskId}`
  type: string; // event_type / invalidation kind
  payload: Record<string, unknown>;
  traceId?: string;
  at: string;
}

type Subscriber = (event: RealtimeEvent) => void;

const subscribers = new Set<Subscriber>();

export function publish(event: Omit<RealtimeEvent, "at" | "traceId"> & { traceId?: string }): void {
  const full: RealtimeEvent = { ...event, at: new Date().toISOString(), traceId: event.traceId ?? newTraceId() };
  for (const sub of subscribers) {
    try {
      sub(full);
    } catch {
      // a broken subscriber must never corrupt state (NFR-006)
    }
  }
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export const topics = {
  project: (projectId: string) => `project:${projectId}`,
  task: (taskId: string) => `task:${taskId}`,
  run: (runId: string) => `run:${runId}`,
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
};
