/** Shapes and helpers of the AI settings page (settings/ai) and its dialogs. */

/** A coding-agent CLI found on the server or on a user's machine. */
export type CliDet = { id: string; name: string; installed: boolean; version: string | null; auth: "ok" | "missing" | "unknown" };

/** Where a Local CLI connection can run: the server (operators only) or a connected machine. */
export type CliOpts = {
  server: { enabled: boolean; can_create?: boolean; clis: CliDet[] };
  machines: Array<{ id: string; name: string; platform: string; online: boolean; clis: CliDet[] }>;
};

/** What uses a connection or profile: its profiles and the role bindings pointing at it. */
export type Usage = { profiles?: number; bindings: number | Array<unknown>; roles?: Array<{ role: string; scope: string; project_id: string | null }> };

/** "TASK_DECOMPOSITION" → "task decomposition". */
export const roleName = (role: string) => role.toLowerCase().replaceAll("_", " ");

export const usageOf = (item: Record<string, unknown>) => (item.usage ?? { bindings: 0 }) as Usage;

/** Role bindings that would block a delete, described for people. */
export function blockers(item: Record<string, unknown>): string[] {
  const u = usageOf(item);
  const roles = u.roles ?? (Array.isArray(u.bindings) ? (u.bindings as Array<{ role: string; scope: string; project_id: string | null }>) : []);
  const count = Array.isArray(u.bindings) ? u.bindings.length : u.bindings;
  const named = roles.map((r) => `${roleName(r.role)} (${r.scope === "PROJECT" ? "one project" : "workspace default"})`);
  const hidden = count - named.length;
  return hidden > 0 ? [...named, `${hidden} in other workspaces`] : named;
}
