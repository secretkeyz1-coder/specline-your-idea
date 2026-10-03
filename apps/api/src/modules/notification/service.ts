import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";

/** In-app notifications with duplicate suppression (T191/T192). */

export async function notify(
  db: DbExecutor,
  input: {
    workspaceId: string;
    projectId?: string | null;
    recipientUserId: string;
    type: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
    dedupeKey?: string;
  },
): Promise<void> {
  if (input.dedupeKey) {
    const [existing] = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.dedupeKey, input.dedupeKey))
      .limit(1);
    if (existing) return;
  }
  await db.insert(schema.notifications).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    recipientUserId: input.recipientUserId,
    type: input.type,
    title: input.title,
    body: input.body ?? "",
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    dedupeKey: input.dedupeKey ?? null,
  });
}

/** Notify every member of the project's workspace who can act on it. */
export async function notifyWorkspaceMembers(
  db: DbExecutor,
  input: {
    workspaceId: string;
    projectId?: string | null;
    type: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
    dedupeKey?: string;
    excludeUserId?: string;
  },
): Promise<void> {
  const members = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, input.workspaceId));
  await Promise.all(
    members
      .filter((m) => m.userId !== input.excludeUserId)
      .map((m) =>
        notify(db, {
          workspaceId: input.workspaceId,
          projectId: input.projectId ?? null,
          recipientUserId: m.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${m.userId}` : undefined,
        }),
      ),
  );
}

export async function listNotifications(db: DbExecutor, userId: string, limit = 50) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.recipientUserId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
}

export async function markRead(db: DbExecutor, userId: string, notificationId: string) {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.recipientUserId, userId)));
}

export async function unreadCount(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.recipientUserId, userId), isNull(schema.notifications.readAt)));
  return row?.count ?? 0;
}
