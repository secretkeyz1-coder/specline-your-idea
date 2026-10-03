<script lang="ts">
  import { enhance } from "$app/forms";
  import { afterNavigate } from "$app/navigation";
  import { tick } from "svelte";
  import { page } from "$app/state";
  import Notice from "$lib/components/Notice.svelte";
  import AddConnectionDialog from "$lib/components/ai/AddConnectionDialog.svelte";
  import EditConnectionDialog from "$lib/components/ai/EditConnectionDialog.svelte";
  import RemoveDialog from "$lib/components/ai/RemoveDialog.svelte";
  import { blockers, usageOf, type CliOpts } from "$lib/ai-settings.js";
  import { postFormAction } from "$lib/form-action.js";
  import type { ProjectOverride } from "./+page.server.js";
  import {
    Check,
    KeyRound,
    Plug,
    ShieldCheck,
    Sparkles,
    Plus,
    X,
    RefreshCw,
    Play,
    CircleAlert,
    ListChecks,
    ArrowRight,
    Pencil,
    Trash2,
    Power,
    Unlink,
    CircleCheck,
    ChevronRight,
  } from "lucide-svelte";

  let {
    data,
    form,
  }: {
    data: {
      workspaceId: string | null;
      connections: Array<Record<string, unknown>>;
      profiles: Array<Record<string, unknown>>;
      bindings: Record<string, { profile_name: string; model_id: string; provider_name: string; active: boolean }>;
      projectOverrides: ProjectOverride[];
    };
    form: { ok?: boolean; notice?: string; message?: string; test?: string; aiReady?: boolean } | null;
  } = $props();

  let busy = $state<string | null>(null);
  let section = $state<"connections" | "profiles" | "roles">("connections");

  const ROLES: Array<{ id: string; desc: string }> = [
    { id: "DISCOVERY", desc: "Asks the discovery questions and spots assumptions" },
    { id: "SPECIFICATION", desc: "Writes the requirements and flags ambiguity" },
    { id: "ARCHITECTURE", desc: "Recommends the stack and writes the technical design" },
    { id: "TASK_DECOMPOSITION", desc: "Breaks the design into tasks with their dependencies" },
    { id: "REVIEW", desc: "Helps review submitted work and analyse bugs" },
    { id: "CONVERGENCE", desc: "Checks the built work against the requirements before release" },
  ];

  const SECTIONS = [
    { id: "connections" as const, num: "1", label: "Provider connections", short: "Providers", icon: Plug },
    { id: "profiles" as const, num: "2", label: "AI profiles", short: "Profiles", icon: Sparkles },
    { id: "roles" as const, num: "3", label: "Role routing", short: "Roles", icon: ShieldCheck },
  ];

  const boundCount = $derived(Object.keys(data.bindings).length);

  // ── Setup guide: connection → model → roles. Derived from saved state, so it
  // shows exactly what is left and disappears once everything is bound.
  const PLANNING_ROLES = ["DISCOVERY", "SPECIFICATION", "ARCHITECTURE", "TASK_DECOMPOSITION"];
  const planningBound = $derived(PLANNING_ROLES.filter((r) => data.bindings[r]).length);
  const setup = $derived([
    { id: "connections" as const, label: "Add a provider", done: data.connections.length > 0 },
    { id: "profiles" as const, label: "Pick a model", done: data.profiles.length > 0 },
    { id: "roles" as const, label: "Use it for planning", done: planningBound === PLANNING_ROLES.length },
  ]);
  const setupComplete = $derived(setup.every((s) => s.done));
  const nextSetup = $derived(setup.find((s) => !s.done)?.id ?? null);
  const fromStart = $derived(page.url.searchParams.get("from") === "start");
  // A fresh workspace binds the first model to every role in one go.
  let bindAll = $state(untrackedDefaultBindAll());
  function untrackedDefaultBindAll() {
    return Object.keys(data.bindings).length === 0;
  }

  // ── Add Connection dialog ──
  let showAdd = $state(false);

  function openAdd() {
    showAdd = true;
  }

  // ── Per-connection fetched models ──
  let modelsByConnection = $state<Record<string, string[]>>({});
  // Per connection: why the last fetch failed, or null once it worked. Absent = never fetched.
  let modelErrors = $state<Record<string, string | null>>({});
  let loadingConnection = $state<string | null>(null);
  // Probe model input per connection (declared before template use).
  let probeModel = $state<Record<string, string>>({});

  async function fetchModels(connectionId: string) {
    loadingConnection = connectionId;
    try {
      const fd = new FormData();
      fd.set("providerId", connectionId);
      const r = await postFormAction<{ models?: string[]; error?: string | null }>("?/fetchModels", fd);
      // An upstream refusal comes back as a success with `error` set: it is a
      // failure to report, not "0 models".
      const failure = r.ok ? (r.data.error ?? null) : r.message;
      modelsByConnection = { ...modelsByConnection, [connectionId]: failure ? [] : (r.data.models ?? []) };
      modelErrors = { ...modelErrors, [connectionId]: failure };
    } finally {
      loadingConnection = null;
    }
  }

  function modelsFor(connectionId: string): string[] {
    return modelsByConnection[connectionId] ?? [];
  }

  // ── Profile creation ──
  let profileConnection = $state("");
  let manualModel = $state(false);

  const profileModels = $derived(profileConnection ? modelsFor(profileConnection) : []);

  async function onProfileConnectionChange(value: string) {
    profileConnection = value;
    manualModel = false;
    if (value && modelsFor(value).length === 0 && loadingConnection !== value) {
      await fetchModels(value);
    }
  }

  // ── Editing and removal (the dialogs are components) ──
  let editConn = $state<Record<string, unknown> | null>(null);
  let editProfileId = $state<string | null>(null);
  function openEdit(connection: Record<string, unknown>) {
    editConn = connection;
  }
  let removing = $state<{ kind: "provider" | "profile"; id: string; name: string } | null>(null);

  const removingItem = $derived(
    removing ? (removing.kind === "provider" ? data.connections : data.profiles).find((c) => String(c.id) === removing!.id) ?? null : null,
  );
  // While setup is incomplete, always land on the next unfinished step;
  // afterwards keep the section the user last chose across reloads.
  afterNavigate(() => {
    if (nextSetup) {
      section = nextSetup;
      return;
    }
    const saved = sessionStorage.getItem("ai-settings-section");
    if (saved === "connections" || saved === "profiles" || saved === "roles") section = saved;
    if (form?.notice || form?.message || form?.test) advanced = true;
  });

  function setSection(s: "connections" | "profiles" | "roles") {
    section = s;
    advanced = true;
    sessionStorage.setItem("ai-settings-section", s);
  }

  // ── Task-first: once AI works, the page leads with what is in use; the
  // provider / profile / role machinery is one click away, not the page.
  const ROLE_NAME: Record<string, string> = {
    DISCOVERY: "Discovery",
    SPECIFICATION: "Requirements",
    ARCHITECTURE: "Stack & design",
    TASK_DECOMPOSITION: "Tasks",
    REVIEW: "Review",
    CONVERGENCE: "Release check",
  };
  const inUse = $derived.by(() => {
    const groups = new Map<string, { model: string; provider: string; roles: string[] }>();
    for (const role of ROLES) {
      const b = data.bindings[role.id];
      if (!b) continue;
      const key = `${b.provider_name}\u0000${b.model_id}`;
      const g = groups.get(key) ?? { model: b.model_id, provider: b.provider_name, roles: [] };
      g.roles.push(role.id);
      groups.set(key, g);
    }
    return [...groups.values()];
  });
  const unbound = $derived(ROLES.filter((r) => !data.bindings[r.id]).map((r) => ROLE_NAME[r.id] ?? r.id));
  let advanced = $state(false);
  // Shown once AI works and the user came to set it up: the way on is the page's one primary.
  const showReady = $derived(setupComplete && (fromStart || !!form?.aiReady));
  // "Your AI" in one read: the model most steps use, then only the steps that differ.
  // Six identical rows said one fact six times.
  type Bound = { profile_name: string; model_id: string; provider_name: string; active: boolean };
  const sameModel = (x: Bound, y: Bound) => x.model_id === y.model_id && x.provider_name === y.provider_name;
  const defaultBinding = $derived.by(() => {
    const active = ROLES.map((r) => data.bindings[r.id]).filter((b): b is Bound => Boolean(b?.active));
    let best: Bound | null = null;
    let bestCount = 0;
    for (const b of active) {
      const count = active.filter((o) => sameModel(o, b)).length;
      if (count > bestCount) [best, bestCount] = [b, count];
    }
    return best ? { binding: best, count: bestCount } : null;
  });
  // Steps that use another model, a disabled one, or none.
  const exceptions = $derived(
    ROLES.filter((r) => {
      const b = data.bindings[r.id];
      return !b || !b.active || !defaultBinding || !sameModel(b, defaultBinding.binding);
    }),
  );
  // The connection behind a binding, for its last test (the API records each "Test").
  const testedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  function health(providerName: string): { ok: boolean | null; text: string } {
    const c = data.connections.find((x) => x.name === providerName);
    const at = c?.last_tested_at ? testedFormat.format(new Date(String(c.last_tested_at))) : null;
    if (!c || !c.last_test_status || !at) return { ok: null, text: "Not tested yet" };
    return c.last_test_status === "OK" ? { ok: true, text: `Test passed ${at}` } : { ok: false, text: `Last test failed ${at}` };
  }
  // "Assign model" / "Change": open Advanced on role routing and bring it into view.
  async function openRoles() {
    setSection("roles");
    await tick();
    document.getElementById("ai-advanced")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
</script>

<svelte:head>
  <title>AI providers — SDD Control Plane</title>
</svelte:head>

{#snippet sectionPanel()}
  <!-- Active section panel -->
  <section class="min-w-0">
    <!-- ═══════════ SECTION 1: CONNECTIONS ═══════════ -->
    {#if section === "connections"}
      <div class="card flex flex-col gap-4 border border-line bg-base-100 p-5 max-sm:p-4 sm:p-6">
        <h2 class="flex items-center gap-2 text-[16px] font-semibold text-base-content">
          <Plug class="size-4 text-primary-ink" aria-hidden="true" />Provider connections
        </h2>

        {#if data.connections.length === 0}
          <p class="text-[13px] text-base-content/80">No provider yet. Any OpenAI-compatible endpoint, Anthropic, Gemini or a local CLI.</p>
        {/if}

        <ul class="flex flex-col gap-3">
          {#each data.connections as connection (String(connection.id))}
            {@const cid = String(connection.id)}
            {@const models = modelsFor(cid)}
            {@const disabled = connection.status === "DISABLED"}
            {@const usage = usageOf(connection)}
            {@const own = connection.scope_type !== "SYSTEM"}
            <li class="flex flex-col gap-3 rounded-box border border-line bg-base-200 p-4 text-[13px] max-sm:p-3.5 {disabled ? 'opacity-80' : ''}">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-[14px] font-semibold text-base-content">{connection.name as string}</p>
                  <p class="text-xs text-base-content/75">
                    {String(connection.provider_type).toLowerCase().replaceAll("_", "-")}
                    {#if connection.base_url}· <span class="break-all font-mono">{String(connection.base_url).replace(/^https?:\/\//, "").slice(0, 36)}</span>{/if}
                  </p>
                  <p class="text-xs text-base-content/80">
                    {usage.profiles ?? 0} profile{usage.profiles === 1 ? "" : "s"} ·
                    {#if usage.bindings}used by {usage.bindings} role{usage.bindings === 1 ? "" : "s"}{:else}not used by any role{/if}
                  </p>
                </div>
                {#if disabled}
                  <span class="badge badge-sm shrink-0 gap-1 border-warn/40 bg-warn-soft font-semibold text-warn"><Power class="size-3" aria-hidden="true" />Disabled</span>
                {:else if connection.has_credential}
                  <span class="badge badge-sm shrink-0 gap-1 border-mint/40 bg-mint-soft font-semibold text-mint" title="API key encrypted at rest">
                    <KeyRound class="size-3" aria-hidden="true" />Key stored
                  </span>
                {/if}
              </div>

              <div class="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  class="btn btn-sm btn-outline"
                  onclick={() => {
                    if (models.length === 0) return fetchModels(cid);
                    modelsByConnection = { ...modelsByConnection, [cid]: [] };
                    modelErrors = Object.fromEntries(Object.entries(modelErrors).filter(([k]) => k !== cid));
                  }}
                  disabled={loadingConnection === cid}
                  title={models.length === 0 ? "Fetch the model catalogue from this endpoint" : "Hide model list"}
                >
                  {#if loadingConnection === cid}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                  {:else if models.length === 0}<RefreshCw class="size-3.5" aria-hidden="true" />
                  {:else}<X class="size-3.5" aria-hidden="true" />{/if}
                  <span>{models.length === 0 ? "Fetch models" : "Hide models"}</span>
                </button>

                <form
                  method="post"
                  action="?/testProvider"
                  use:enhance={() => {
                    busy = cid;
                    return async ({ update }) => {
                      busy = null;
                      // Keep the typed model id: a reset would clear the bound
                      // input, and the next test usually reuses it.
                      await update({ reset: false });
                    };
                  }}
                  class="join max-sm:w-full"
                >
                  <input type="hidden" name="providerId" value={cid} />
                  <input
                    class="input input-sm join-item w-40 font-mono text-xs max-sm:h-11 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
                    type="text"
                    name="model_id"
                    aria-label={`Model to test ${String(connection.name)} with`}
                    placeholder="model id to test"
                    bind:value={probeModel[cid]}
                  />
                  <button class="btn btn-sm join-item max-sm:h-11" type="submit" disabled={busy !== null}>
                    {#if busy === cid}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Play class="size-3.5" aria-hidden="true" />{/if}
                    <span>Test</span>
                  </button>
                </form>

                {#if own}
                  <div class="ml-auto flex items-center gap-1">
                    <button type="button" class="btn btn-sm btn-ghost text-base-content/80 hover:text-base-content" onclick={() => openEdit(connection)}>
                      <Pencil class="size-3.5" aria-hidden="true" /><span>Edit</span>
                    </button>
                    <form
                      method="post"
                      action="?/setProviderStatus"
                      use:enhance={() => {
                        busy = `status-${cid}`;
                        return async ({ update }) => {
                          busy = null;
                          await update();
                        };
                      }}
                    >
                      <input type="hidden" name="providerId" value={cid} />
                      <input type="hidden" name="status" value={disabled ? "ACTIVE" : "DISABLED"} />
                      <button
                        class="btn btn-sm btn-ghost text-base-content/80 hover:text-base-content"
                        type="submit"
                        disabled={busy !== null}
                        title={disabled ? "Use this connection again" : "Stop using this connection; roles bound to it use their fallback"}
                      >
                        {#if busy === `status-${cid}`}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Power class="size-3.5" aria-hidden="true" />{/if}
                        <span>{disabled ? "Enable" : "Disable"}</span>
                      </button>
                    </form>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost text-danger hover:bg-danger-soft"
                      onclick={() => (removing = { kind: "provider", id: cid, name: String(connection.name) })}
                    >
                      <Trash2 class="size-3.5" aria-hidden="true" /><span>Delete</span>
                    </button>
                  </div>
                {/if}
              </div>

              {#if loadingConnection === cid}
                <p class="flex items-center gap-1.5 text-xs text-base-content/75"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span> Fetching catalogue…</p>
              {:else if modelErrors[cid]}
                <p class="flex items-start gap-1.5 rounded-box border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                  <CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span class="break-all">Could not fetch models: {modelErrors[cid]}</span>
                </p>
              {:else if modelErrors[cid] === null && models.length === 0}
                <p class="text-xs text-base-content/80" role="status">The endpoint listed no models. Type the model id on the profile instead.</p>
              {:else if models.length > 0}
                <div class="rounded-box border border-line bg-base-100 p-3">
                  <p class="mb-1.5 text-xs font-semibold text-base-content/80">{models.length} models available</p>
                  <div class="flex max-h-[140px] flex-wrap gap-1 overflow-y-auto">
                    {#each models as m (m)}
                      <span class="badge badge-sm border-line font-mono">{m}</span>
                    {/each}
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>

        <button type="button" class="btn {setupComplete ? 'btn-outline' : 'btn-primary max-sm:btn-lg'} self-start max-sm:w-full" onclick={openAdd}>
          <Plus class="size-4" aria-hidden="true" /><span>Add provider</span>
        </button>
      </div>

    <!-- ═══════════ SECTION 2: PROFILES ═══════════ -->
    {:else if section === "profiles"}
      <div class="card flex flex-col gap-4 border border-line bg-base-100 p-5 max-sm:p-4 sm:p-6">
        <h2 class="flex items-center gap-2 text-[16px] font-semibold text-base-content">
          <Sparkles class="size-4 text-violet" aria-hidden="true" />AI profiles
        </h2>

        <ul class="flex flex-col gap-2">
          {#each data.profiles as profile (String(profile.id))}
            {@const pid = String(profile.id)}
            {@const bound = blockers(profile)}
            {@const via = data.connections.find((c) => String(c.id) === String(profile.provider_connection_id))}
            <li class="rounded-box border border-line bg-base-200 px-4 py-3 text-[13px]">
              {#if editProfileId === pid}
                <form
                  method="post"
                  action="?/updateProfile"
                  use:enhance={() => {
                    busy = `profile-${pid}`;
                    return async ({ result, update }) => {
                      busy = null;
                      if (result.type === "success") editProfileId = null;
                      await update();
                    };
                  }}
                  class="flex flex-col gap-3"
                >
                  <input type="hidden" name="profileId" value={pid} />
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-xs font-medium text-base-content/80" for={`profile-name-${pid}`}>Profile name</label>
                      <input id={`profile-name-${pid}`} class="input input-sm w-full" name="name" required value={String(profile.name)} />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-xs font-medium text-base-content/80" for={`profile-model-${pid}`}>Model id</label>
                      <input id={`profile-model-${pid}`} class="input input-sm w-full font-mono" name="model_id" required value={String(profile.model_id)} list={`profile-models-${pid}`} />
                      <datalist id={`profile-models-${pid}`}>
                        {#each modelsFor(String(profile.provider_connection_id)) as m (m)}<option value={m}></option>{/each}
                      </datalist>
                    </div>
                  </div>
                  {#if bound.length}
                    <p class="text-xs text-base-content/80">Also changes: {bound.join(", ")}.</p>
                  {/if}
                  <div class="flex gap-1.5">
                    <button class="btn btn-sm btn-outline" type="submit" disabled={busy !== null}>
                      {#if busy === `profile-${pid}`}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                      <span>Save profile</span>
                    </button>
                    <button class="btn btn-sm btn-ghost" type="button" onclick={() => (editProfileId = null)}>Cancel</button>
                  </div>
                </form>
              {:else}
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-[14px] font-semibold text-base-content">{String(profile.name)}</p>
                    <p class="font-mono text-xs text-base-content/80">{String(profile.model_id)}</p>
                    <p class="text-xs text-base-content/75">
                      {via ? String(via.name) : "connection not listed"} · {bound.length ? `bound to ${bound.length} role${bound.length === 1 ? "" : "s"}` : "not bound"}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost btn-square text-base-content/80 hover:text-base-content"
                      aria-label={`Edit profile ${String(profile.name)}`}
                      onclick={() => {
                        editProfileId = pid;
                        const cid = String(profile.provider_connection_id);
                        if (modelsFor(cid).length === 0 && loadingConnection !== cid) void fetchModels(cid);
                      }}
                    >
                      <Pencil class="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost btn-square text-danger hover:bg-danger-soft"
                      aria-label={`Delete profile ${String(profile.name)}`}
                      onclick={() => (removing = { kind: "profile", id: pid, name: String(profile.name) })}
                    >
                      <Trash2 class="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              {/if}
            </li>
          {:else}
            <li class="text-[13px] text-base-content/80">No profiles yet.</li>
          {/each}
        </ul>

        <form
          method="post"
          action="?/createProfile"
          use:enhance={() => {
            busy = "newprof";
            return async ({ update }) => {
              busy = null;
              profileConnection = "";
              manualModel = false;
              await update();
            };
          }}
          class="flex flex-col gap-3 border-t border-line pt-4"
        >
          <input type="hidden" name="workspaceId" value={data.workspaceId} />
          <p class="text-[14px] font-semibold text-base-content">New profile</p>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-base-content/80" for="profile-name">Profile name</label>
              <input id="profile-name" class="input w-full" type="text" name="name" required placeholder="e.g. Deep planning" />
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-base-content/80" for="profile-connection">Connection</label>
              <select
                id="profile-connection"
                class="select w-full"
                name="provider_connection_id"
                required
                bind:value={profileConnection}
                onchange={() => onProfileConnectionChange(profileConnection)}
              >
                <option value="" disabled selected>Select connection…</option>
                {#each data.connections as connection}
                  <option value={String(connection.id)}>{String(connection.name)}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-medium text-base-content/80" for="profile-model">Model</label>
              {#if profileConnection && manualModel}
                <button type="button" class="link link-hover text-xs text-base-content" onclick={() => (manualModel = false)}>Pick from fetched models</button>
              {:else if profileConnection && profileModels.length === 0}
                <button type="button" class="link link-hover text-xs text-base-content" onclick={() => (manualModel = true)}>Type manually instead</button>
              {/if}
            </div>

            {#if manualModel}
              <input id="profile-model" class="input w-full font-mono" type="text" name="model_id" required placeholder="model id (e.g. claude-3-7-sonnet)" />
            {:else if profileModels.length > 0}
              <select id="profile-model" class="select w-full font-mono" name="model_id" required>
                <option value="" disabled selected>Select from {profileModels.length} models…</option>
                {#each profileModels as m (m)}
                  <option value={m}>{m}</option>
                {/each}
              </select>
            {:else if profileConnection}
              <div class="flex items-center gap-2">
                <input id="profile-model" class="input w-full font-mono" type="text" name="model_id" required placeholder="model id (fetch unavailable)" />
                <button
                  type="button"
                  class="btn btn-outline btn-square shrink-0"
                  onclick={() => fetchModels(profileConnection)}
                  disabled={loadingConnection === profileConnection}
                >
                  {#if loadingConnection === profileConnection}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<RefreshCw class="size-3.5" aria-hidden="true" />{/if}
                  <span class="sr-only">Fetch models for this connection</span>
                </button>
              </div>
            {:else}
              <input id="profile-model" class="input w-full" type="text" name="model_id" disabled placeholder="Select a connection first" />
            {/if}
          </div>

          <label class="flex cursor-pointer items-start gap-2.5 text-[13px] text-base-content">
            <input type="checkbox" name="bind_all" value="1" class="checkbox checkbox-sm mt-0.5" bind:checked={bindAll} />
            <span>Use for every planning step <span class="text-base-content/75">· split later</span></span>
          </label>

          <button class="btn {setupComplete ? 'btn-outline' : 'btn-primary max-sm:btn-lg'} self-start max-sm:w-full" type="submit" disabled={busy !== null || data.connections.length === 0}>
            {#if busy === "newprof"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
            <span>Save profile</span>
          </button>
        </form>
      </div>

    <!-- ═══════════ SECTION 3: ROLE ROUTING ═══════════ -->
    {:else}
      <div class="card flex flex-col gap-4 border border-line bg-base-100 p-5 max-sm:p-4 sm:p-6">
        <div class="flex items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 text-[16px] font-semibold text-base-content">
            <ShieldCheck class="size-4 text-sky" aria-hidden="true" />Role routing
          </h2>
          <span class="text-xs font-medium text-base-content/75 tabular-nums">{boundCount}/{ROLES.length} bound</span>
        </div>

        <div class="flex flex-col gap-2">
          {#each ROLES as role (role.id)}
            {@const bound = data.bindings[role.id]}
            <form
              method="post"
              action="?/bindRole"
              use:enhance={() => {
                busy = role.id;
                return async ({ update }) => {
                  busy = null;
                  await update();
                };
              }}
              class="flex flex-col gap-2 rounded-box border border-line bg-base-200 p-3.5 text-[13px]"
            >
              <input type="hidden" name="workspaceId" value={data.workspaceId} />
              <input type="hidden" name="scope" value="WORKSPACE" />
              <input type="hidden" name="role" value={role.id} />

              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="min-w-0">
                  <span class="font-semibold text-base-content">{ROLE_NAME[role.id] ?? role.id}</span>
                  <span class="block text-xs text-base-content/75">{role.desc}</span>
                </p>
                {#if bound && !bound.active}
                  <span class="badge badge-sm gap-1 border-warn/40 bg-warn-soft font-semibold text-warn" title={`${bound.profile_name} is disabled — using fallback · ${bound.provider_name} · ${bound.model_id}`}>
                    <CircleAlert class="size-3" aria-hidden="true" />{bound.profile_name} disabled
                  </span>
                {:else if bound}
                  <span class="badge badge-sm gap-1 border-mint/40 bg-mint-soft font-semibold text-mint" title={`${bound.provider_name} · ${bound.model_id}`}>
                    <ListChecks class="size-3" aria-hidden="true" />{bound.profile_name}
                  </span>
                {:else}
                  <span class="badge badge-sm gap-1 border-line bg-base-100 font-semibold text-base-content/80">
                    <CircleAlert class="size-3" aria-hidden="true" />Fallback
                  </span>
                {/if}
              </div>

              <div class="flex items-center gap-1.5 max-sm:flex-wrap">
                <select
                  class="select select-sm min-w-0 flex-1 pe-8 max-sm:h-11 max-sm:basis-full"
                  name="ai_profile_id"
                  required
                  aria-label={`AI profile for ${role.id.toLowerCase().replaceAll("_", " ")}`}
                >
                  <option value="" disabled selected>{bound ? `Rebind (current: ${bound.profile_name})` : "Select profile…"}</option>
                  {#each data.profiles as profile}
                    <option value={String(profile.id)}>{String(profile.name)} ({String(profile.model_id)})</option>
                  {/each}
                </select>
                <button class="btn btn-sm btn-outline shrink-0 max-sm:h-11 max-sm:flex-1" type="submit" disabled={data.profiles.length === 0 || busy !== null}>
                  {#if busy === role.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                  <span>Bind</span>
                </button>
                {#if bound}
                  <!-- Same form, other action: nested forms are not allowed. -->
                  <button
                    class="btn btn-sm btn-ghost shrink-0 text-base-content/80 hover:text-base-content max-sm:h-11 max-sm:flex-1"
                    type="submit"
                    formaction="?/unbindRole"
                    formnovalidate
                    disabled={busy !== null}
                    title="Remove this binding; the role falls back to built-in behaviour"
                  >
                    <Unlink class="size-3.5" aria-hidden="true" /><span>Unbind</span>
                  </button>
                {/if}
              </div>
            </form>
          {/each}
        </div>

        <p class="text-xs text-base-content/75">Without a model, a step falls back to built-in behaviour.</p>
      </div>

      <!-- Project overrides win over the defaults above: listed so a stale one can be found and removed. -->
      <div class="card mt-4 flex flex-col gap-3 border border-line bg-base-100 p-5 sm:p-6">
        <div class="flex items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 text-[16px] font-semibold text-base-content">
            <ShieldCheck class="size-4 text-sky" aria-hidden="true" />Project overrides
          </h2>
          <span class="text-xs font-medium text-base-content/75 tabular-nums">{data.projectOverrides.length}</span>
        </div>
        {#if data.projectOverrides.length === 0}
          <p class="text-[13px] text-base-content/80">None — every project uses the defaults.</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each data.projectOverrides as o (`${o.project.id}:${o.role}`)}
              {@const key = `project:${o.project.id}:${o.role}`}
              <li class="rounded-box border border-line bg-base-200 p-3.5 text-[13px]">
                <form
                  method="post"
                  action="?/unbindProjectRole"
                  use:enhance={() => {
                    busy = key;
                    return async ({ update }) => {
                      busy = null;
                      await update();
                    };
                  }}
                  class="flex flex-wrap items-center justify-between gap-2"
                >
                  <input type="hidden" name="projectId" value={o.project.id} />
                  <input type="hidden" name="projectKey" value={o.project.key} />
                  <input type="hidden" name="role" value={o.role} />
                  <div class="min-w-0">
                    <p class="font-semibold text-base-content">
                      <a class="link link-hover" href={`/projects/${o.project.id}`}>{o.project.key}</a>
                      <span class="font-normal text-base-content/80">· {o.role.toLowerCase().replaceAll("_", " ")}</span>
                    </p>
                    <p class="truncate text-base-content/80" title={`${o.provider_name} · ${o.model_id}`}>
                      {o.profile_name} <span class="text-base-content/75">({o.provider_name} · {o.model_id})</span>
                    </p>
                    {#if o.problem}
                      <p class="mt-1 flex items-start gap-1 text-warn">
                        <CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>{o.problem}</span>
                      </p>
                    {/if}
                  </div>
                  <button
                    class="btn btn-sm btn-ghost shrink-0 text-base-content/80 hover:text-base-content"
                    type="submit"
                    disabled={busy !== null}
                    title="Remove this override; the role uses the workspace default in this project"
                  >
                    {#if busy === key}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Trash2 class="size-3.5" aria-hidden="true" />{/if}
                    <span>Remove override</span>
                  </button>
                </form>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

<main class="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-4 pt-6 pb-20 sm:gap-8 sm:px-6 sm:pt-10 lg:px-10">
  <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] font-extrabold tracking-tight text-balance sm:text-[32px]">
        {#if !data.workspaceId}AI providers
        {:else if setupComplete}
          {#if unbound.length === 0}Every planning step has a <span class="text-primary-ink">model</span>.
          {:else}{ROLES.length - unbound.length} of {ROLES.length} planning steps have a model.{/if}
        {:else if nextSetup === "connections"}Connect an AI provider.
        {:else if nextSetup === "profiles"}Pick a model.
        {:else}Use it for planning.{/if}
      </h1>
      {#if data.workspaceId && !setupComplete}
        <p class="text-[14px] text-base-content/80">Needed to generate discovery, requirements, design and tasks.</p>
      {/if}
    </div>
    {#if data.workspaceId && setupComplete}
      <button type="button" class="btn btn-ghost max-sm:-ms-3 max-sm:-mt-2 max-sm:h-11 max-sm:px-3" onclick={openAdd}><Plus class="size-4" aria-hidden="true" />Add provider</button>
    {/if}
  </header>

  {#if form?.notice}
    <Notice tone="success">{form.notice}</Notice>
  {:else if form?.test}
    <Notice tone="info">{form.test}</Notice>
  {:else if form?.message}
    <Notice tone="error">{form.message}</Notice>
  {/if}

  {#if !data.workspaceId}
    <div class="card border border-line bg-base-100 p-8 text-center text-[13px] text-base-content/80">Sign in as a workspace admin to manage AI providers.</div>
  {:else if !setupComplete}
    <!-- Setup: the three steps are the navigation; the page lands on the next unfinished one. -->
    <nav class="card border border-line bg-base-100 px-4 py-4 sm:px-6" aria-label="AI setup steps">
      <ol class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        {#each setup as step, i (step.id)}
          {@const here = section === step.id}
          <li class="flex items-center gap-2 sm:flex-1 sm:last:flex-none">
            <button
              type="button"
              onclick={() => setSection(step.id)}
              aria-current={here ? "step" : undefined}
              class="btn btn-ghost h-auto min-h-11 justify-start gap-2.5 ps-2 pe-3.5 text-[14px] {here ? 'bg-primary-soft font-semibold text-base-content' : 'font-medium text-base-content/80'}"
            >
              <span
                class="inline-grid size-5.5 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums {step.done
                  ? 'bg-mint-soft text-mint'
                  : here
                    ? 'bg-primary text-primary-content ring-4 ring-primary-soft'
                    : 'border border-line-control text-base-content/75'}"
                aria-hidden="true"
              >
                {#if step.done}<Check class="size-3" strokeWidth={3} />{:else}{i + 1}{/if}
              </span>
              <span>{step.label}</span>
              <span class="sr-only">{step.done ? "(done)" : "(to do)"}</span>
            </button>
            {#if i < setup.length - 1}
              <span class="hidden h-0.5 min-w-6 flex-1 rounded-full {step.done ? 'bg-mint' : 'bg-line'} sm:block" aria-hidden="true"></span>
            {/if}
          </li>
        {/each}
      </ol>
    </nav>
    {@render sectionPanel()}
  {:else}
    {#if showReady}
      <div class="card flex flex-wrap items-center gap-3 border border-mint/40 bg-base-100 p-4 sm:px-5">
        <CircleCheck class="size-5 shrink-0 text-mint" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-[14px] font-semibold text-base-content">AI is ready</p>
        <a class="btn btn-primary max-sm:btn-lg max-sm:w-full" href="/">Start your first project<ArrowRight class="size-4" aria-hidden="true" /></a>
      </div>
    {/if}

    <!-- What the planning steps use now, in one read: the default, then only what differs -->
    <section class="card overflow-hidden border border-line bg-base-100" aria-labelledby="your-ai-title">
      <div class="flex flex-col gap-4 px-5 py-5 max-sm:px-4 sm:px-8 sm:py-6">
        {#if defaultBinding}
          {@const d = defaultBinding.binding}
          {@const h = health(d.provider_name)}
          <div class="flex flex-col gap-1">
            <h2 id="your-ai-title" class="text-xs font-semibold text-base-content/80">
              {defaultBinding.count === ROLES.length ? "Every step uses" : `${defaultBinding.count} of ${ROLES.length} steps use`}
            </h2>
            <p class="min-w-0 text-[16px] break-words text-base-content">
              <span class="font-mono font-semibold">{d.model_id}</span>
              <span class="text-base-content/80"> via {d.provider_name}</span>
            </p>
            <p class="flex items-center gap-1.5 text-[13px] {h.ok === false ? 'text-danger' : 'text-base-content/80'}">
              {#if h.ok === true}<CircleCheck class="size-3.5 shrink-0 text-mint" aria-hidden="true" />{:else if h.ok === false}<CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />{/if}
              {h.text}
            </p>
          </div>
        {:else}
          <h2 id="your-ai-title" class="text-[15px] font-semibold text-base-content">No model assigned yet</h2>
        {/if}

        {#if exceptions.length && (defaultBinding || exceptions.length < ROLES.length)}
          <div class="flex flex-col gap-1 border-t border-line pt-4">
            <h3 class="text-xs font-semibold text-base-content/80">{defaultBinding ? "Except" : "Steps"}</h3>
            <ul class="flex flex-col">
              {#each exceptions as role (role.id)}
                {@const b = data.bindings[role.id]}
                <li class="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
                  <span class="text-[14px] font-semibold text-base-content">{ROLE_NAME[role.id] ?? role.id}</span>
                  {#if b && b.active}
                    <span class="min-w-0 truncate text-[13px]" title={`${b.model_id} via ${b.provider_name}`}>
                      <span class="font-mono font-medium text-base-content">{b.model_id}</span>
                      <span class="text-base-content/80"> via {b.provider_name}</span>
                    </span>
                  {:else if b}
                    <span class="badge badge-sm gap-1 border-warn/40 bg-warn-soft font-semibold text-warn" title={`${b.profile_name} is disabled — using fallback`}>
                      <CircleAlert class="size-3" aria-hidden="true" />Disabled
                    </span>
                  {:else}
                    <span class="badge badge-sm gap-1 border-warn/40 bg-warn-soft font-semibold text-warn">
                      <CircleAlert class="size-3" aria-hidden="true" />No model
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-line bg-base-200 px-5 py-4 max-sm:px-4 sm:px-8">
        {#if unbound.length && !showReady}
          <button type="button" class="btn btn-primary max-sm:btn-lg max-sm:w-full" onclick={openRoles}>Assign model<ArrowRight class="size-4" aria-hidden="true" /></button>
        {:else}
          <button type="button" class="btn btn-outline max-sm:w-full" onclick={openRoles}>{unbound.length ? "Assign model" : "Change models"}</button>
        {/if}
      </div>
    </section>

    <!-- Connections, profiles and role routing: one click away, not the page -->
    <details id="ai-advanced" class="card scroll-mt-20 border border-line bg-base-100" bind:open={advanced}>
      <summary class="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-box px-5 py-4 max-sm:min-h-13 max-sm:px-4 max-sm:py-3 sm:px-8 [&::-webkit-details-marker]:hidden">
        <ChevronRight class="size-4 shrink-0 text-base-content/80 transition-transform {advanced ? 'rotate-90' : ''}" aria-hidden="true" />
        <span class="text-[14px] font-semibold text-base-content">Advanced</span>
        <span class="truncate text-[13px] text-base-content/75 max-sm:hidden">Connections, profiles, role routing</span>
      </summary>
      <div class="grid items-start gap-5 border-t border-line p-4 max-sm:gap-4 max-sm:p-3 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav class="min-w-0 lg:sticky lg:top-6" aria-label="Settings sections">
          <!-- daisyUI menu: a row that scrolls on phones, a column from lg. -->
          <ul class="menu menu-horizontal w-full flex-nowrap gap-1 overflow-x-auto p-0 text-[13px] max-sm:grid max-sm:grid-cols-3 max-sm:overflow-visible lg:menu-vertical lg:overflow-visible">
            {#each SECTIONS as s (s.id)}
              {@const count = s.id === "connections" ? data.connections.length : s.id === "profiles" ? data.profiles.length : boundCount}
              <li class="shrink-0 max-lg:flex-1 max-sm:min-w-0">
                <button
                  type="button"
                  onclick={() => setSection(s.id)}
                  aria-current={section === s.id ? "true" : undefined}
                  class="flex min-h-10 items-center gap-2.5 rounded-field max-sm:min-h-11 max-sm:justify-center max-sm:gap-1.5 max-sm:px-2 {section === s.id ? 'menu-active font-semibold' : 'text-base-content/80'}"
                >
                  <s.icon class="size-3.5 max-sm:hidden" aria-hidden="true" />
                  <span class="whitespace-nowrap max-sm:hidden">{s.label}</span>
                  <span class="whitespace-nowrap sm:hidden">{s.short}</span>
                  <span class="ml-auto text-xs tabular-nums text-base-content/75 max-sm:ml-0">{count}</span>
                </button>
              </li>
            {/each}
          </ul>
        </nav>
        {@render sectionPanel()}
      </div>
    </details>
  {/if}
</main>
<AddConnectionDialog bind:open={showAdd} bind:busy workspaceId={data.workspaceId} cliOpts={(data as { cli?: CliOpts | null }).cli ?? null} message={form?.message} />
<EditConnectionDialog bind:connection={editConn} bind:busy message={form?.message} />
<RemoveDialog bind:removing bind:busy item={removingItem} onOpenRoles={() => void openRoles()} />
