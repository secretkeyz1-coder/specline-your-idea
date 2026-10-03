import { schema } from "@sdd/db";

/** Discovery's shared shapes: session and question rows, the batch size, and required and blocking topics. */

export type DiscoverySession = typeof schema.discoverySessions.$inferSelect;
export type DiscoveryQuestion = typeof schema.discoveryQuestions.$inferSelect;

export const BATCH_SIZE = 5;

export const REQUIRED_TOPICS = ["problem", "primary_users", "core_workflows", "mvp_scope"] as const;
export const BLOCKING_TOPICS = ["problem", "primary_users", "core_workflows", "roles_permissions", "platform"] as const;

/**
 * Key suffix of questions from the built-in bank that was retired (questions
 * now only come from the model). Answered ones stay as the person's answers;
 * unanswered ones are hidden and dropped.
 */
export const BUILT_IN_KEY = "_fallback";

/** A question from the retired built-in bank that was never answered. */
export const isUnansweredBuiltIn = (q: { questionKey: string; status: string }) => q.status === "PENDING" && q.questionKey.endsWith(BUILT_IN_KEY);
