import type { LayoutServerLoad } from "./$types.js";
import { api, sessionFrom } from "$lib/server/api.js";

export const load: LayoutServerLoad = async ({ fetch, cookies }) => {
  const session = sessionFrom(cookies);
  let user = null;
  let needsBootstrap = false;
  let projects: Array<{ id: string; key: string; name: string; lifecycleStatus: string }> = [];
  try {
    // Both at once: this layout re-runs after every form action. Signed out,
    // the project list answers 401 and is dropped.
    const [status, list] = await Promise.all([
      api<{
        needs_bootstrap: boolean;
        authenticated: boolean;
        user: { id: string; email: string; display_name: string } | null;
      }>(fetch, session, "GET", "/api/v1/auth/status"),
      session.token
        ? api<{ projects: typeof projects }>(fetch, session, "GET", "/api/v1/projects?limit=50").catch(() => ({ projects: [] as typeof projects }))
        : Promise.resolve({ projects: [] as typeof projects }),
    ]);
    needsBootstrap = status.needs_bootstrap;
    user = status.authenticated ? status.user : null;
    // Only what the switcher shows: the API rows carry the whole idea and rules.
    if (user) projects = (list.projects ?? []).map(({ id, key, name, lifecycleStatus }) => ({ id, key, name, lifecycleStatus }));
  } catch {
    // API unreachable — pages surface their own error states.
  }
  // No `url` access here: reading it makes this (two API calls) re-run on
  // every client navigation.
  return { user, needsBootstrap, projects };
};
