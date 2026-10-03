import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { errors } from "@sdd/shared";
import { assertSessionActive } from "./session.js";

/** Exact wording after whitespace normalization only: no lowercasing, fuzzy or
 * semantic matching (different defaults/paraphrases remain independent).
 */
export function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ");
}

/** Lock the parent row, then compare and insert in the same transaction. Every
 * assumption writer uses this lock, including completion and AI batches.
 * Existing duplicates are retained for audit/history rather than deleted.
 */
export async function recordAssumption(db: DbExecutor, input: { sessionId: string; description: string; impact: string }) {
  return db.transaction(async tx => {
    const [session] = await tx.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, input.sessionId)).for("update").limit(1);
    if (!session) throw errors.notFound("Discovery session", input.sessionId);
    assertSessionActive(session);
    const description = normalizeDescription(input.description);
    const existing = await tx.select().from(schema.discoveryAssumptions).where(eq(schema.discoveryAssumptions.sessionId, session.id));
    const duplicate = existing.find(row => normalizeDescription(row.description) === description);
    if (duplicate) return duplicate;
    return (await tx.insert(schema.discoveryAssumptions).values({ ...input, description }).returning())[0]!;
  });
}
