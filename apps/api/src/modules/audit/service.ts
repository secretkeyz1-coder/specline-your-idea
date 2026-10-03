import { schema, type DbExecutor } from "@sdd/db";
import type { ActorType } from "@sdd/contracts";

/** Append-only audit service (T185/T186, C14). Never updated, only inserted. */

export type AuditSource = "WEB" | "CLI" | "MCP" | "DAEMON" | "AI" | "SYSTEM";

export async function audit(
  db: DbExecutor,
  input: {
    workspaceId: string;
    projectId?: string | null;
    actorType: ActorType;
    actorId: string;
    source: AuditSource;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    traceId?: string | null;
  },
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    actorType: input.actorType,
    actorId: input.actorId,
    source: input.source,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
    traceId: input.traceId ?? null,
  });
}
