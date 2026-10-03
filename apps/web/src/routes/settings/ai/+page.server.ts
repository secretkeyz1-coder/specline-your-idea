import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import { AI_ROLES, BAD_ID, formUuid, isAiRole, isUuid } from "$lib/server/ids.js";
import { baseUrlOriginChanged } from "$lib/origin.js";

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  // An outage or an expired session must not look like "nothing configured":
  // the page would invite setting up providers that already exist.
  let workspaceId: string | null = null;
  let connections: { connections: Array<Record<string, unknown>> } = { connections: [] };
  let profiles: { profiles: Array<Record<string, unknown>> } = { profiles: [] };
  let bound: {
    bindings: Array<{ role: string; ai_profile_id: string; profile_name: string; model_id: string; provider_name: string; active?: boolean }>;
    project_overrides?: ProjectOverride[];
  } = {
    bindings: [],
  };
  try {
    const me = await api<{ workspaces: Array<{ id: string; name: string }> }>(fetch, session, "GET", "/api/v1/auth/me");
    const first = me.workspaces[0]?.id;
    workspaceId = isUuid(first) ? first : null;
    if (workspaceId) {
      // Independent reads: fetch them together instead of one after another.
      [connections, profiles, bound] = await Promise.all([
        api<typeof connections>(fetch, session, "GET", `/api/v1/workspaces/${workspaceId}/ai/providers`),
        api<typeof profiles>(fetch, session, "GET", `/api/v1/workspaces/${workspaceId}/ai/profiles`),
        api<typeof bound>(fetch, session, "GET", `/api/v1/workspaces/${workspaceId}/ai-role-bindings`),
      ]);
    }
  } catch (e) {
    throwLoadError(e);
  }
  // Where a local CLI (Claude Code, Codex) can run for this user. Optional:
  // without it the Local CLI option just shows no detection.
  const cli = workspaceId ? await api<CliOptions>(fetch, session, "GET", "/api/v1/ai/cli").catch(() => null) : null;
  const bindings: Record<string, { profile_name: string; model_id: string; provider_name: string; active: boolean }> = {};
  for (const b of bound.bindings) bindings[b.role] = { profile_name: b.profile_name, model_id: b.model_id, provider_name: b.provider_name, active: b.active !== false };
  return {
    workspaceId,
    connections: connections.connections,
    profiles: profiles.profiles,
    bindings,
    projectOverrides: bound.project_overrides ?? [],
    cli,
  };
};

/** A role bound for one project: it wins over the workspace default there. */
export type ProjectOverride = {
  project: { id: string; key: string; name: string };
  role: string;
  ai_profile_id: string;
  profile_name: string;
  model_id: string;
  provider_name: string;
  /** Why it cannot run on that model; null when it can. */
  problem: string | null;
};

type CliDetection = { id: string; name: string; installed: boolean; version: string | null; auth: "ok" | "missing" | "unknown"; suggestedModels: string[] };
export type CliOptions = {
  server: { enabled: boolean; can_create?: boolean; clis: CliDetection[] };
  machines: Array<{ id: string; name: string; platform: string; online: boolean; clis: CliDetection[] }>;
};

/** An API refusal as the page's error notice; anything else as a generic one. */
function failWith(error: unknown, fallback: string) {
  rethrowKitError(error);
  if (error instanceof ApiError) return fail(error.status, { message: error.message });
  return fail(500, { message: fallback });
}

const roleLabel = (role: string) => role.toLowerCase().replaceAll("_", " ");

/** A missing or malformed id from the form: never interpolated into an API path. */
const badId = () => fail(400, { message: BAD_ID });

export const actions: Actions = {
  createProvider: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const workspaceId = formUuid(form, "workspaceId");
    if (!workspaceId) return badId();
    const providerType = String(form.get("provider_type") ?? "OPENAI_COMPATIBLE");
    const base = String(form.get("base_url") ?? "").trim();
    const credential = String(form.get("credential") ?? "").trim();
    const isCli = providerType === "LOCAL_CLI";
    try {
      await api(fetch, session, "POST", `/api/v1/workspaces/${workspaceId}/ai/providers`, {
        body: {
          name: String(form.get("name") ?? ""),
          provider_type: providerType,
          base_url: base || undefined,
          credential: credential && !isCli ? { type: "BEARER", value: credential } : undefined,
          // A full technical design can take minutes on slower models; a CLI
          // answers only when it is done, so it gets the whole run.
          timeout_ms: isCli ? 900_000 : 240_000,
        },
      });
      return {
        ok: true,
        notice: isCli
          ? "Local CLI connection saved. It uses the CLI's own sign-in — no key is stored here."
          : "Provider connection saved — the credential is encrypted and never shown again.",
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not save the provider connection." });
    }
  },

  /** Probe a SAVED connection with a model id (real completion round-trip). */
  testProvider: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const providerId = formUuid(form, "providerId");
    if (!providerId) return badId();
    try {
      const result = await api<{ ok: boolean; latencyMs: number; error?: string; errorCode?: string }>(
        fetch,
        session,
        "POST",
        `/api/v1/ai/providers/${providerId}/test`,
        { body: { model_id: String(form.get("model_id") ?? "").trim() || undefined } },
      );
      return {
        ok: true,
        test: result.ok
          ? `Connection OK (${result.latencyMs}ms)`
          : `Failed: ${result.error ?? "unknown error"}${result.errorCode && !result.error?.includes(result.errorCode) ? ` [${result.errorCode}]` : ""}`,
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Test failed to run." });
    }
  },

  /** Fetch the model catalogue of a SAVED connection (GET /models upstream). */
  fetchModels: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const providerId = formUuid(form, "providerId");
    if (!providerId) return badId();
    try {
      const result = await api<{ models: string[]; error?: string }>(
        fetch,
        session,
        "GET",
        `/api/v1/ai/providers/${providerId}/models`,
      );
      return { models: result.models ?? [], error: result.error ?? null };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not fetch models." });
    }
  },

  /** Fetch the model catalogue for UNSAVED dialog data (base url + key from the form). */
  previewModels: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    try {
      const result = await api<{ models: string[]; error?: string }>(
        fetch,
        session,
        "POST",
        `/api/v1/ai/providers/models-preview`,
        {
          body: {
            provider_type: String(form.get("provider_type") ?? "OPENAI_COMPATIBLE"),
            base_url: String(form.get("base_url") ?? ""),
            credential: String(form.get("credential") ?? "") || undefined,
          },
        },
      );
      return { models: result.models ?? [], error: result.error ?? null };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not fetch models from this endpoint." });
    }
  },

  createProfile: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const workspaceId = formUuid(form, "workspaceId");
    if (!workspaceId) return badId();
    const bindAll = form.get("bind_all") === "1";
    try {
      const { profile } = await api<{ profile: { id: string } }>(fetch, session, "POST", `/api/v1/workspaces/${workspaceId}/ai/profiles`, {
        body: {
          name: String(form.get("name") ?? ""),
          provider_connection_id: String(form.get("provider_connection_id") ?? ""),
          model_id: String(form.get("model_id") ?? ""),
        },
      });
      if (!bindAll) return { ok: true, notice: "AI profile saved." };
      // First-run shortcut: one model for every planning role, instead of six
      // separate bindings before anything works. Roles can be split later.
      const failed: string[] = [];
      for (const role of AI_ROLES) {
        try {
          await api(fetch, session, "PUT", `/api/v1/workspaces/${workspaceId}/ai-role-bindings/${role}`, { body: { ai_profile_id: profile.id } });
        } catch {
          failed.push(role.toLowerCase().replaceAll("_", " "));
        }
      }
      return failed.length
        ? { ok: true, notice: `Profile saved, but these roles could not be bound: ${failed.join(", ")}. Bind them under Role routing.` }
        : { ok: true, notice: "Profile saved and used for every planning role. AI is ready.", aiReady: true };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not save the profile." });
    }
  },

  bindRole: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const workspaceId = formUuid(form, "workspaceId");
    const role = form.get("role");
    if (!workspaceId || !isAiRole(role)) return badId();
    try {
      await api(fetch, session, "PUT", `/api/v1/workspaces/${workspaceId}/ai-role-bindings/${role}`, {
        body: { ai_profile_id: String(form.get("ai_profile_id") ?? "") },
      });
      return { ok: true, notice: `Role "${role.toLowerCase().replaceAll("_", " ")}" bound.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not bind the role." });
    }
  },

  /** Rename, move or re-key a saved connection. A blank key field keeps the stored key. */
  updateProvider: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const providerId = formUuid(form, "providerId");
    if (!providerId) return badId();
    const isCli = form.get("provider_type") === "LOCAL_CLI";
    const credential = String(form.get("credential") ?? "").trim();
    const timeoutSeconds = Number(form.get("timeout_seconds") ?? "");
    // The stored key is never sent to a new host: moving the base URL to
    // another origin needs the key for that host (the API enforces it too).
    if (!isCli && !credential && form.get("had_credential") === "1" && baseUrlOriginChanged(String(form.get("original_base_url") ?? ""), String(form.get("base_url") ?? ""))) {
      return fail(400, { message: "The base URL now points to another host. Enter the API key for it — the stored key is not sent to a new host." });
    }
    try {
      const updated = await api<{ cleared_secrets?: string[] }>(fetch, session, "PATCH", `/api/v1/ai/providers/${providerId}`, {
        body: {
          name: String(form.get("name") ?? "").trim(),
          // A local CLI keeps its target: moving it to another machine is a new connection.
          ...(isCli ? {} : { base_url: String(form.get("base_url") ?? "").trim() || null }),
          ...(credential && !isCli ? { credential: { type: "BEARER", value: credential } } : {}),
          ...(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? { timeout_ms: Math.round(timeoutSeconds * 1000) } : {}),
        },
      });
      // A move to another host drops stored secrets the request didn't re-send (secret headers, say).
      const names: Record<string, string> = { credential: "API key", secret_headers: "secret headers" };
      const cleared = (updated.cleared_secrets ?? []).map((c) => names[c] ?? c);
      if (cleared.length) return { ok: true, notice: `Connection updated. The base URL points to another host, so the stored ${cleared.join(" and ")} ${cleared.length > 1 ? "were" : "was"} removed — enter them again if this host needs them.` };
      return { ok: true, notice: credential ? "Connection updated and the new key stored — test it before relying on it." : "Connection updated." };
    } catch (error) {
      return failWith(error, "Could not update the connection.");
    }
  },

  /** Take a connection out of use without losing its profiles and role bindings. */
  setProviderStatus: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const status = form.get("status") === "DISABLED" ? "DISABLED" : "ACTIVE";
    const providerId = formUuid(form, "providerId");
    if (!providerId) return badId();
    try {
      await api(fetch, session, "PATCH", `/api/v1/ai/providers/${providerId}`, { body: { status } });
      return {
        ok: true,
        notice:
          status === "DISABLED"
            ? "Connection disabled. Roles bound to it now use their fallback until you enable it again."
            : "Connection enabled again.",
      };
    } catch (error) {
      return failWith(error, "Could not change the connection.");
    }
  },

  deleteProvider: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const providerId = formUuid(form, "providerId");
    if (!providerId) return badId();
    try {
      const result = await api<{ profiles_removed: number }>(fetch, session, "DELETE", `/api/v1/ai/providers/${providerId}`);
      const n = result.profiles_removed;
      return { ok: true, notice: n ? `Connection deleted with its ${n} unused profile${n === 1 ? "" : "s"}.` : "Connection deleted." };
    } catch (error) {
      return failWith(error, "Could not delete the connection.");
    }
  },

  updateProfile: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const profileId = formUuid(form, "profileId");
    if (!profileId) return badId();
    try {
      await api(fetch, session, "PATCH", `/api/v1/ai/profiles/${profileId}`, {
        body: { name: String(form.get("name") ?? "").trim(), model_id: String(form.get("model_id") ?? "").trim() },
      });
      return { ok: true, notice: "Profile updated. Every role bound to it uses the new settings." };
    } catch (error) {
      return failWith(error, "Could not update the profile.");
    }
  },

  deleteProfile: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const profileId = formUuid(form, "profileId");
    if (!profileId) return badId();
    try {
      await api(fetch, session, "DELETE", `/api/v1/ai/profiles/${profileId}`);
      return { ok: true, notice: "Profile deleted." };
    } catch (error) {
      return failWith(error, "Could not delete the profile.");
    }
  },

  /** Remove a workspace role binding: the role falls back to built-in behaviour. */
  unbindRole: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const workspaceId = formUuid(form, "workspaceId");
    const role = form.get("role");
    if (!workspaceId || !isAiRole(role)) return badId();
    try {
      await api(fetch, session, "DELETE", `/api/v1/workspaces/${workspaceId}/ai-role-bindings/${role}`);
      return { ok: true, notice: `Role "${roleLabel(role)}" unbound — it now uses its fallback.` };
    } catch (error) {
      return failWith(error, "Could not unbind the role.");
    }
  },

  /** Remove a project override: that project's role goes back to the workspace default. */
  unbindProjectRole: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const projectId = formUuid(form, "projectId");
    const role = form.get("role");
    if (!projectId || !isAiRole(role)) return badId();
    const projectKey = String(form.get("projectKey") ?? "").slice(0, 40);
    try {
      await api(fetch, session, "DELETE", `/api/v1/projects/${projectId}/ai-role-bindings/${role}`);
      return { ok: true, notice: `Removed the ${roleLabel(role)} override${projectKey ? ` for ${projectKey}` : ""} — it now uses the workspace default.` };
    } catch (error) {
      return failWith(error, "Could not remove the project override.");
    }
  },
};
