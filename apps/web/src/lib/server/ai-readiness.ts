import { api, ApiError, type Session } from "./api.js";

/** Roles that generate something on the way to the first work order. */
export const PLANNING_ROLES = ["DISCOVERY", "SPECIFICATION", "ARCHITECTURE", "TASK_DECOMPOSITION"] as const;

export interface AiReadiness {
  /** ready: every planning role is bound · partial: some · missing: none ·
   *  managed: the caller cannot see workspace routing (not an admin). */
  state: "ready" | "partial" | "missing" | "managed";
  bound: number;
  required: number;
  connections: number;
  profiles: number;
  workspaceId: string | null;
}

/** Workspace-level AI setup state, for first-run guidance. Never throws. */
export async function aiReadiness(fetch: typeof globalThis.fetch, session: Session): Promise<AiReadiness> {
  const empty: AiReadiness = { state: "missing", bound: 0, required: PLANNING_ROLES.length, connections: 0, profiles: 0, workspaceId: null };
  try {
    const me = await api<{ workspaces: Array<{ id: string; role: string }> }>(fetch, session, "GET", "/api/v1/auth/me");
    const workspace = me.workspaces[0];
    if (!workspace) return empty;
    const base = `/api/v1/workspaces/${workspace.id}`;
    const [bindings, connections, profiles] = await Promise.all([
      api<{ bindings: Array<{ role: string }> }>(fetch, session, "GET", `${base}/ai-role-bindings`).catch((e: unknown) =>
        e instanceof ApiError && e.status === 403 ? null : { bindings: [] },
      ),
      api<{ connections: unknown[] }>(fetch, session, "GET", `${base}/ai/providers`).catch(() => ({ connections: [] })),
      api<{ profiles: unknown[] }>(fetch, session, "GET", `${base}/ai/profiles`).catch(() => ({ profiles: [] })),
    ]);
    const common = { required: PLANNING_ROLES.length, connections: connections.connections.length, profiles: profiles.profiles.length, workspaceId: workspace.id };
    if (bindings === null) return { ...common, state: "managed", bound: 0 };
    const boundRoles = new Set(bindings.bindings.map((b) => b.role));
    const bound = PLANNING_ROLES.filter((r) => boundRoles.has(r)).length;
    return { ...common, bound, state: bound === PLANNING_ROLES.length ? "ready" : bound > 0 ? "partial" : "missing" };
  } catch {
    return empty;
  }
}
