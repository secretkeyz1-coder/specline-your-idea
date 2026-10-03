/**
 * Application-level planning prompt templates (docs/21), by stage:
 * - prompts/planning.ts — discovery, requirements, stack, technical design
 * - prompts/ux.ts       — UI reference: plan, screen, element, example data
 * - prompts/ux-od.ts    — UI reference screens in open-design style (seed templates)
 * - prompts/delivery.ts — task decomposition, task lint, review, convergence, bug
 * - prompts/design-system.ts — reading a pasted design system into the spec
 * All of them end with the shared language rule (prompts/language.ts).
 */
export * from "./prompts/planning.js";
export * from "./prompts/ux.js";
export * from "./prompts/ux-od.js";
export * from "./prompts/delivery.js";
export * from "./prompts/design-system.js";
