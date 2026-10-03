/**
 * Execution engine (Phase 10, T107–T116, FR-070..080).
 * The SERVER is the only authority that commits transitions (C2/C3, docs/12 §13).
 * The claim transaction is atomic under concurrency (FR-070/071, NFR-004).
 *
 * Split by job: events.ts (event log, transitions), claim.ts, runs.ts (start,
 * heartbeat, progress, tests, block), evidence.ts (evidence policy, submit, manual
 * run), lifecycle.ts (retire, unblock, cancel), leases.ts (expiry sweeper). This
 * file only re-exports, so importers keep one entry point.
 */
export * from "./events.js";
export * from "./claim.js";
export * from "./runs.js";
export * from "./evidence.js";
export * from "./lifecycle.js";
export * from "./leases.js";
