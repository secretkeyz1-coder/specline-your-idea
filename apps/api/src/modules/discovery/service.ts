/**
 * Discovery engine (Phase 3, docs/04 §4–5) — BATCH model.
 * Permintaan produk: 5 pertanyaan per layar; AI aktif menyusun giliran
 * berikutnya; pengguna menyelesaikan batch atau meminta pendalaman.
 * Invariant: PENDING questions ARE the current batch (never stray singles) —
 * stray pendings previously froze readiness and created an endless treadmill.
 * Planning state lives in the database, never only in model memory (docs/06 §7).
 *
 * Split by job: topics.ts (rows, topics; questions come only from the model), session.ts (start,
 * active session, transcript), batch.ts (next batch), answers.ts, readiness.ts
 * (gate, assumptions), completion.ts (defer, complete). This file only
 * re-exports, so importers keep one entry point.
 */
export * from "./topics.js";
export * from "./session.js";
export * from "./batch.js";
export * from "./answers.js";
export * from "./readiness.js";
export * from "./completion.js";
