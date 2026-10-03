/**
 * Provider connection + AI profile services (T029–T033).
 * Scope rules: SYSTEM rows are operator-managed; workspace users may only
 * mutate WORKSPACE rows of their own workspace (FR-154, docs/08 §23).
 * Secrets are encrypted at rest and never returned by reads (C21/C22).
 *
 * By entity: connections/providers.ts (connections: create, test, edit,
 * delete), connections/profiles.ts, connections/bindings.ts (role bindings,
 * usages, effective routing), connections/models.ts (model discovery).
 */
export * from "./connections/providers.js";
export * from "./connections/profiles.js";
export * from "./connections/bindings.js";
export * from "./connections/models.js";
