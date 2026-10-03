import { afterAll, describe, expect, test } from "bun:test";
import { guardedFetch, TOTAL_TIMEOUT_FACTOR } from "../src/index.js";

/**
 * Provider timeouts: `timeoutMs` is an idle limit, so a generation that keeps
 * streaming is not cut, while a stalled or endless response still fails.
 */

const encoder = new TextEncoder();
const timers = new Set<ReturnType<typeof setInterval>>();

/** A body that sends `chunks` pieces, one every `everyMs` (Infinity = forever). */
function drip(everyMs: number, chunks: number): ReadableStream<Uint8Array> {
  let sent = 0;
  let timer: ReturnType<typeof setInterval>;
  return new ReadableStream({
    start(ctrl) {
      timer = setInterval(() => {
        if (sent >= chunks) {
          clearInterval(timer);
          ctrl.close();
          return;
        }
        sent++;
        ctrl.enqueue(encoder.encode(`chunk ${sent}\n`));
      }, everyMs);
      timers.add(timer);
    },
    cancel() {
      clearInterval(timer);
    },
  });
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    // Headers at once, then a chunk every 40ms for ~480ms in all.
    if (path === "/steady") return new Response(drip(40, 12));
    // Headers, one chunk, then silence.
    if (path === "/stall") {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode("chunk 1\n"));
          },
        }),
      );
    }
    // A chunk every 40ms, never finishing.
    if (path === "/endless") return new Response(drip(40, Number.POSITIVE_INFINITY));
    return new Response("ok");
  },
});

afterAll(() => {
  for (const t of timers) clearInterval(t);
  server.stop(true);
});

const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
const opts = (timeoutMs: number) => ({ method: "GET", timeoutMs, maxBytes: 1_000_000, allowPrivateEgress: true });

describe("provider timeouts", () => {
  test("a response that keeps streaming outlives the idle limit", async () => {
    // 480ms of streaming against a 150ms idle limit (total cap 600ms).
    const res = await guardedFetch(url("/steady"), opts(150));
    const text = await res.text();
    expect(text.trim().split("\n")).toHaveLength(12);
  });

  test("a response that stalls fails after the idle limit", async () => {
    const started = Date.now();
    const res = await guardedFetch(url("/stall"), opts(150));
    await expect(res.text()).rejects.toThrow(/did not respond within/);
    expect(Date.now() - started).toBeLessThan(150 * TOTAL_TIMEOUT_FACTOR);
  });

  test("a response that never ends fails at the total cap", async () => {
    const started = Date.now();
    const res = await guardedFetch(url("/endless"), opts(100));
    await expect(res.text()).rejects.toThrow(/did not finish within/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100 * TOTAL_TIMEOUT_FACTOR - 20);
  });
});
