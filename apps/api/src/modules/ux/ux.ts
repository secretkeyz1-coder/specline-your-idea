/**
 * UI reference (the "ux" artifact): optional, after the technical design.
 *
 * The AI first plans the key screens, then writes one self-contained,
 * mid-fidelity HTML document per screen — one call each, so a slow model never
 * has to fit a whole product into one request. The draft revision is filled in
 * place until it is approved; approval freezes it like any other artifact.
 *
 * Split by job: ux-draft.ts (the locked draft and shared helpers), ux-plan.ts (plan,
 * add/remove screens, scope), ux-draw.ts (draw a screen), ux-edit.ts (save, undo,
 * restore, element edit, check), ux-comments.ts, ux-state.ts (read side). Checks live
 * in ux-rules/ux-lint/ux-render/ux-approval; the frame in ux-shell. This file only
 * re-exports, so importers keep one entry point.
 */
export * from "./ux-draft.js";
export * from "./ux-draw.js";
export * from "./ux-plan.js";
export * from "./ux-edit.js";
export * from "./ux-comments.js";
export * from "./ux-state.js";
export * from "./ux-platform.js";
