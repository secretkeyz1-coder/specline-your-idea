import type { RequestHandler } from "./$types.js";
import { ApiError, openSse, sessionFrom } from "$lib/server/api.js";

/** Same-origin SSE proxy (T141): forwards the project event stream to the browser. */

export const GET: RequestHandler = async ({ fetch, cookies, params, request }) => {
  const session = sessionFrom(cookies);
  // Gate before opening a stream: without this, an unauthenticated caller would
  // receive the API's 401 JSON envelope published as `text/event-stream`.
  if (!session.token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const abort = new AbortController();
  // The browser navigating away / closing the tab aborts the request; propagate
  // it so the upstream fetch and its reader are actually cancelled.
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  // Open the upstream BEFORE answering. If the API refuses (expired session,
  // no access, project gone, API down) the browser gets that non-200 status —
  // and EventSource stops reconnecting on a non-200 response. Previously the
  // proxy answered 200 and then emitted an `update` event, which made the board
  // run invalidateAll() every ~3s for as long as the tab stayed open.
  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await openSse(fetch, session, params.projectId, abort.signal);
  } catch (error) {
    const status = error instanceof ApiError && error.status >= 400 ? error.status : 502;
    return new Response(error instanceof Error ? error.message : "Event stream unavailable", { status });
  }

  const reader = upstream.getReader();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Upstream ended (e.g. API restart): tell the client with a DISTINCT
          // event — it must not be mistaken for a data change.
          controller.enqueue(encoder.encode('event: stream_ended\ndata: {}\n\n'));
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        if (!abort.signal.aborted) {
          try {
            controller.enqueue(encoder.encode('event: stream_ended\ndata: {}\n\n'));
          } catch {
            // consumer already gone
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Consumer disconnected: stop the upstream read immediately.
      abort.abort();
      void reader.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Defensive: this stream must never be buffered by an intermediary.
      "x-accel-buffering": "no",
    },
  });
};
