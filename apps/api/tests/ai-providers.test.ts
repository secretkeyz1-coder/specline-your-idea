import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/**
 * AI provider management against a running API + PostgreSQL: edit, disable,
 * delete (refused while in use) and unbind for connections and profiles.
 * Roles are bound at PROJECT scope on a lab project only, so the operator's
 * real workspace defaults are never touched.
 */

const BASE = process.env.SDD_TEST_API ?? "http://localhost:4000";
const EMAIL = process.env.SDD_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SDD_TEST_PASSWORD ?? "";

let cookie = "";
let ready = true;
let workspaceId = "";
let projectId = "";
const created: string[] = [];

type Err = { error: { code: string; message: string; details: { bindings?: Array<{ role: string; scope: string }> } | null } };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie: `sdd_session=${cookie}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("sdd_session=")) cookie = /sdd_session=([^;]+)/.exec(setCookie)![1]!;
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

beforeAll(async () => {
  try {
    const health = await fetch(`${BASE}/readyz`).catch(() => null);
    if (!health?.ok) throw new Error(`API not ready at ${BASE}`);
    if (!PASSWORD) throw new Error("SDD_TEST_PASSWORD is not set");
    const login = await api("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
    if (login.status !== 200) throw new Error("login failed");
    const me = await api<{ workspaces: Array<{ id: string }> }>("GET", "/api/v1/auth/me");
    workspaceId = me.data.workspaces[0]!.id;
    const project = await api<{ project: { id: string } }>("POST", "/api/v1/projects", {
      name: "AI Provider Lab",
      high_level_idea: "Integration test project for editing and removing AI provider connections.",
      key: `TAIP${Math.floor(Math.random() * 900 + 100)}`,
    });
    projectId = project.data.project.id;
  } catch (error) {
    ready = false;
    console.log(`    (skipping AI provider suite — environment unavailable: ${error instanceof Error ? error.message : error})`);
  }
});

afterAll(async () => {
  if (!ready) return;
  // Leave nothing behind even when an assertion failed midway.
  for (const role of ["DISCOVERY", "SPECIFICATION"]) await api("DELETE", `/api/v1/projects/${projectId}/ai-role-bindings/${role}`);
  for (const id of created) await api("DELETE", `/api/v1/ai/providers/${id}`);
});

describe("AI provider connections: edit, disable, delete", () => {
  let connectionId = "";
  let profileId = "";

  test("a connection in use by a role cannot be deleted, and says which role", async () => {
    if (!ready) return;
    // Codex may not run on the server: its sandbox does not stop file reads.
    const codex = await api<Err>("POST", `/api/v1/workspaces/${workspaceId}/ai/providers`, { name: "Lab Codex", provider_type: "LOCAL_CLI", base_url: "cli://server/codex" });
    expect(codex.status).toBe(400);
    expect(codex.data.error.code).toBe("LOCAL_CLI_NOT_ALLOWED");
    // A server CLI is operator-only and saved as a SYSTEM connection (the bootstrap admin is an operator).
    const conn = await api("POST", `/api/v1/workspaces/${workspaceId}/ai/providers`, {
      name: "Lab CLI",
      provider_type: "LOCAL_CLI",
      base_url: "cli://server/claude",
    });
    expect(conn.status).toBe(200);
    expect(conn.data.connection).toMatchObject({ scope_type: "SYSTEM", workspace_id: null });
    connectionId = conn.data.connection.id;
    created.push(connectionId);
    const profile = await api("POST", `/api/v1/workspaces/${workspaceId}/ai/profiles`, { name: "Lab profile", provider_connection_id: connectionId, model_id: "gpt-5" });
    expect(profile.status).toBe(200);
    profileId = profile.data.profile.id;
    const bind = await api("PUT", `/api/v1/projects/${projectId}/ai-role-bindings/DISCOVERY`, { ai_profile_id: profileId });
    expect(bind.status).toBe(200);

    const list = await api<{ connections: Array<{ id: string; usage: { profiles: number; bindings: number } }> }>("GET", `/api/v1/workspaces/${workspaceId}/ai/providers`);
    expect(list.data.connections.find((c) => c.id === connectionId)?.usage).toMatchObject({ profiles: 1, bindings: 1 });

    const refused = await api<Err>("DELETE", `/api/v1/ai/providers/${connectionId}`);
    expect(refused.status).toBe(409);
    expect(refused.data.error.code).toBe("PROVIDER_IN_USE");
    expect(refused.data.error.details?.bindings?.[0]).toMatchObject({ role: "DISCOVERY", scope: "PROJECT" });

    const profileRefused = await api<Err>("DELETE", `/api/v1/ai/profiles/${profileId}`);
    expect(profileRefused.status).toBe(409);
    expect(profileRefused.data.error.code).toBe("PROFILE_IN_USE");
  });

  test("edits change name, timeout and status; a CLI takes no key", async () => {
    if (!ready) return;
    const edit = await api("PATCH", `/api/v1/ai/providers/${connectionId}`, { name: "Lab CLI renamed", timeout_ms: 600_000 });
    expect(edit.status).toBe(200);
    expect(edit.data.connection).toMatchObject({ name: "Lab CLI renamed", timeout_ms: 600_000, provider_type: "LOCAL_CLI" });

    const keyed = await api<Err>("PATCH", `/api/v1/ai/providers/${connectionId}`, { credential: { type: "BEARER", value: "sk-test" } });
    expect(keyed.status).toBe(400);

    const badTarget = await api<Err>("PATCH", `/api/v1/ai/providers/${connectionId}`, { base_url: "https://not-a-cli.example" });
    expect(badTarget.status).toBe(400);

    const disabled = await api("PATCH", `/api/v1/ai/providers/${connectionId}`, { status: "DISABLED" });
    expect(disabled.data.connection.status).toBe("DISABLED");
    const routing = await api<{ project_bindings: Array<{ role: string; provider: { status: string } }> }>("GET", `/api/v1/projects/${projectId}/ai-role-bindings`);
    expect(routing.data.project_bindings.find((b) => b.role === "DISCOVERY")?.provider.status).toBe("DISABLED");
    await api("PATCH", `/api/v1/ai/providers/${connectionId}`, { status: "ACTIVE" });
  });

  test("a profile's model can change and bound roles keep pointing at it", async () => {
    if (!ready) return;
    const edit = await api("PATCH", `/api/v1/ai/profiles/${profileId}`, { model_id: "gpt-5-mini", name: "Lab profile 2" });
    expect(edit.status).toBe(200);
    expect(edit.data.profile).toMatchObject({ model_id: "gpt-5-mini", name: "Lab profile 2" });
    const profiles = await api<{ profiles: Array<{ id: string; usage: { bindings: Array<{ role: string }> } }> }>("GET", `/api/v1/workspaces/${workspaceId}/ai/profiles`);
    expect(profiles.data.profiles.find((p) => p.id === profileId)?.usage.bindings.map((b) => b.role)).toEqual(["DISCOVERY"]);
  });

  test("after unbinding, the connection and its profile are deleted together", async () => {
    if (!ready) return;
    const unbind = await api("DELETE", `/api/v1/projects/${projectId}/ai-role-bindings/DISCOVERY`);
    expect(unbind.status).toBe(200);
    const again = await api("DELETE", `/api/v1/projects/${projectId}/ai-role-bindings/DISCOVERY`);
    expect(again.status).toBe(404);

    const removed = await api("DELETE", `/api/v1/ai/providers/${connectionId}`);
    expect(removed.status).toBe(200);
    expect(removed.data).toMatchObject({ deleted: true, profiles_removed: 1 });
    const profiles = await api<{ profiles: Array<{ id: string }> }>("GET", `/api/v1/workspaces/${workspaceId}/ai/profiles`);
    expect(profiles.data.profiles.some((p) => p.id === profileId)).toBe(false);
    const gone = await api("DELETE", `/api/v1/ai/providers/${connectionId}`);
    expect(gone.status).toBe(404);
  });

  test("replacing or removing a key resets the last test result and never returns the key", async () => {
    if (!ready) return;
    const conn = await api("POST", `/api/v1/workspaces/${workspaceId}/ai/providers`, {
      name: "Lab HTTP",
      provider_type: "OPENAI_COMPATIBLE",
      base_url: "https://api.openai.com/v1",
      credential: { type: "BEARER", value: "sk-first" },
    });
    if (conn.status !== 200) {
      // Egress checks resolve DNS; an offline machine cannot create HTTP connections.
      console.log(`    (skipping key rotation — could not create an HTTP connection: ${JSON.stringify(conn.data).slice(0, 120)})`);
      return;
    }
    const id = conn.data.connection.id as string;
    created.push(id);
    const rotated = await api("PATCH", `/api/v1/ai/providers/${id}`, { credential: { type: "BEARER", value: "sk-second" } });
    expect(rotated.status).toBe(200);
    expect(rotated.data.connection).toMatchObject({ has_credential: true, last_test_status: null });
    expect(JSON.stringify(rotated.data)).not.toContain("sk-second");
    // Same origin, new path: the key stays. New origin without a new key: it is dropped, and the answer says so.
    const samePath = await api("PATCH", `/api/v1/ai/providers/${id}`, { base_url: "https://api.openai.com/v1/" });
    expect(samePath.data).toMatchObject({ connection: { has_credential: true }, cleared_secrets: [] });
    const moved = await api("PATCH", `/api/v1/ai/providers/${id}`, { base_url: "https://api.anthropic.com/v1" });
    if (moved.status === 200) expect(moved.data).toMatchObject({ connection: { has_credential: false }, cleared_secrets: ["credential"] });
    const cleared = await api("PATCH", `/api/v1/ai/providers/${id}`, { credential: null });
    expect(cleared.data.connection.has_credential).toBe(false);
    const removed = await api("DELETE", `/api/v1/ai/providers/${id}`);
    expect(removed.status).toBe(200);
  });
});
