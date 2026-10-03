<script lang="ts">
  import { enhance } from "$app/forms";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { Check, CircleAlert, ListChecks, X } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { CliOpts } from "$lib/ai-settings.js";
  import { postFormAction } from "$lib/form-action.js";

  /** Add a provider connection: an HTTP endpoint with its key, or a Local CLI on the server or a machine. */
  let {
    open = $bindable(false),
    busy = $bindable(null),
    workspaceId,
    cliOpts,
    message,
  }: { open: boolean; busy: string | null; workspaceId: string | null; cliOpts: CliOpts | null; message?: string } = $props();

  let provType = $state("OPENAI_COMPATIBLE");
  let cliTool = $state<"claude" | "codex">("claude");
  let cliWhere = $state("server");
  // Only an operator may run a CLI on the server, and only Claude Code (Codex
  // can read the host's files there); anyone may run either on their own machine.
  const serverUsable = $derived(!!cliOpts?.server.enabled && !!cliOpts?.server.can_create);
  // Default to a machine when this user may not run CLIs on the server.
  $effect(() => {
    if (provType !== "LOCAL_CLI" || !cliOpts) return;
    if (cliWhere === "server" && !serverUsable && cliOpts.machines.length) cliWhere = cliOpts.machines[0]!.id;
  });
  $effect(() => {
    if (cliWhere === "server" && cliTool === "codex") cliTool = "claude";
  });
  const cliTarget = $derived(cliWhere === "server" ? `cli://server/${cliTool}` : `cli://machine/${cliWhere}/${cliTool}`);
  const cliStatus = $derived.by(() => {
    if (!cliOpts) return null;
    const list = cliWhere === "server" ? cliOpts.server.clis : (cliOpts.machines.find((m) => m.id === cliWhere)?.clis ?? []);
    return list.find((c) => c.id === cliTool) ?? null;
  });
  const cliMachine = $derived(cliOpts?.machines.find((m) => m.id === cliWhere) ?? null);

  const EMPTY_PREVIEW = { loading: false, models: [] as string[], error: null as string | null, done: false };
  let previewState = $state({ ...EMPTY_PREVIEW });
  // Every opening starts without the last endpoint's result.
  $effect(() => {
    if (open) previewState = { ...EMPTY_PREVIEW };
  });

  async function submitPreview(formEl: HTMLFormElement) {
    const fd = new FormData(formEl);
    fd.set("base_url", String(fd.get("base_url") ?? "").trim());
    previewState = { loading: true, models: [], error: null, done: false };
    try {
      const r = await postFormAction<{ models?: string[]; error?: string | null }>("?/previewModels", fd);
      previewState = r.ok
        ? { loading: false, models: r.data.models ?? [], error: r.data.error ?? null, done: true }
        : { loading: false, models: [], error: r.message, done: true };
    } finally {
      // Whatever happened above, the button must come back.
      if (previewState.loading) previewState = { ...previewState, loading: false, done: true };
    }
  }
</script>

<Modal bind:open sheetOnPhone labelledby="add-connection-title" describedby="add-connection-desc" boxClass="flex max-h-[85vh] max-w-[540px] flex-col overflow-y-auto overflow-x-hidden rounded-box border border-line p-5 sm:p-7">
  <div class="flex items-center justify-between">
    <h2 id="add-connection-title" class="text-[20px] font-bold tracking-tight text-base-content">Add provider</h2>
    <button type="button" onclick={() => (open = false)} class="btn btn-sm btn-ghost btn-square text-base-content/80 hover:text-base-content" aria-label="Close">
      <X class="size-4" />
    </button>
  </div>
  <p id="add-connection-desc" class="mt-1 text-[13px] text-base-content/80">
    {provType === "LOCAL_CLI"
      ? "A signed-in coding-agent CLI answers the planning prompts."
      : "Endpoint and key. Test it before saving."}
  </p>

  <form
    method="post"
    action="?/createProvider"
    use:enhance={() => {
      busy = "newp";
      return async ({ result, update }) => {
        busy = null;
        // Only close on success — a failed save must not discard the typed key.
        if (result.type === "success") open = false;
        await update({ reset: result.type === "success" });
      };
    }}
    class="mt-5 flex flex-col gap-4 text-[13px]"
  >
    <input type="hidden" name="workspaceId" value={workspaceId} />

    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label for="prov-name" class="mb-1.5 block text-xs font-medium text-base-content/80">Name</label>
        <input id="prov-name" class="input w-full" type="text" name="name" required placeholder="Name (e.g. OpenRouter)" />
      </div>
      <div>
        <label for="prov-type" class="mb-1.5 block text-xs font-medium text-base-content/80">Type</label>
        <select id="prov-type" class="select w-full" name="provider_type" bind:value={provType}>
          <option value="OPENAI_COMPATIBLE">OpenAI-compatible</option>
          <option value="OPENAI">OpenAI</option>
          <option value="ANTHROPIC">Anthropic</option>
          <option value="GEMINI">Gemini</option>
          <option value="CUSTOM_HTTP">Custom HTTP</option>
          <option value="LOCAL_CLI">Local CLI (Claude Code / Codex)</option>
        </select>
      </div>
    </div>

    {#if provType === "LOCAL_CLI"}
      <!-- A CLI signs in on its own: no URL, no key. The target is encoded here. -->
      <input type="hidden" name="base_url" value={cliTarget} />
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label for="cli-tool" class="mb-1.5 block text-xs font-medium text-base-content/80">CLI</label>
          <select id="cli-tool" class="select w-full" bind:value={cliTool}>
            <option value="claude">Claude Code</option>
            <option value="codex" disabled={cliWhere === "server"}>Codex CLI{cliWhere === "server" ? " (own machine only)" : ""}</option>
          </select>
        </div>
        <div>
          <label for="cli-where" class="mb-1.5 block text-xs font-medium text-base-content/80">Runs on</label>
          <select id="cli-where" class="select w-full" bind:value={cliWhere}>
            <option value="server" disabled={!serverUsable}>
              This server{!cliOpts?.server.enabled ? " (turned off)" : !cliOpts?.server.can_create ? " (operators only)" : ""}
            </option>
            {#each cliOpts?.machines ?? [] as m (m.id)}
              <option value={m.id}>{m.name} — {m.online ? "online" : "offline"}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="rounded-box border border-line bg-base-200 p-4 text-xs leading-relaxed text-base-content/80">
        {#if cliWhere === "server" && !cliOpts?.server.enabled}
          <p>
            Running CLIs on the server is off. Set <code class="font-mono">SDD_ENABLE_LOCAL_CLI=true</code> for the API, or run
            it on your own machine: <code class="font-mono">sddctl login</code>, then <code class="font-mono">sdd-agent connect</code>.
          </p>
        {:else if cliWhere === "server" && !serverUsable}
          <p>
            Only a platform operator can run a CLI on the server; it is saved as a system connection. Run it on your own
            machine instead: <code class="font-mono">sddctl login</code>, then <code class="font-mono">sdd-agent connect</code>.
          </p>
        {:else if cliWhere !== "server" && cliMachine && !cliMachine.online}
          <p>
            {cliMachine.name} is offline. On that machine run <code class="font-mono">sdd-agent connect</code> and keep it running —
            generation happens there, with its own {cliTool === "claude" ? "Claude Code" : "Codex"} sign-in.
          </p>
        {:else if cliStatus && !cliStatus.installed}
          <p class="text-warn">{cliStatus.name} was not found there. Install it and make sure it is on PATH.</p>
        {:else if cliStatus && cliStatus.auth === "missing"}
          <p class="text-warn">{cliStatus.name} {cliStatus.version ?? ""} is installed but not signed in. Sign in with the CLI first.</p>
        {:else if cliStatus}
          <p class="text-mint">{cliStatus.name} {cliStatus.version ?? ""} found{cliStatus.auth === "ok" ? " and signed in" : ""}.</p>
        {:else}
          <p>No machines yet. Connect one with <code class="font-mono">sddctl login</code> and <code class="font-mono">sdd-agent connect</code>.</p>
        {/if}
        <p class="mt-1.5">
          It answers planning prompts only: no tools, a throwaway folder, no files touched. Pick the model on the profile
          ({cliTool === "claude" ? "e.g. sonnet, opus, haiku" : "e.g. the Codex model name"}, or <code class="font-mono">default</code>).
        </p>
      </div>
    {:else}
    <div>
      <label for="prov-url" class="mb-1.5 block text-xs font-medium text-base-content/80">Base URL</label>
      <input id="prov-url" class="input w-full font-mono" type="url" name="base_url" placeholder="https://openrouter.ai/api/v1" />
    </div>

    <div>
      <label for="prov-key" class="mb-1.5 block text-xs font-medium text-base-content/80">API key</label>
      <input id="prov-key" class="input w-full" type="password" name="credential" autocomplete="off" placeholder="Stored encrypted at rest, never shown again" />
    </div>

    <!-- Validate endpoint + fetch models before saving -->
    <div class="rounded-box border border-line bg-base-200 p-4">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[13px] font-semibold text-base-content">Models</span>
        <button
          type="button"
          class="btn btn-sm btn-outline max-sm:h-11"
          onclick={async (e) => {
            const formEl = (e.currentTarget as HTMLButtonElement).form as HTMLFormElement;
            await submitPreview(formEl);
          }}
          disabled={previewState.loading}
        >
          {#if previewState.loading}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<ListChecks class="size-3.5" aria-hidden="true" />{/if}
          <span>Test endpoint</span>
        </button>
      </div>

      {#if previewState.loading}
        <p class="mt-2 flex items-center gap-1.5 text-xs text-base-content/75"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span> Contacting endpoint…</p>
      {:else if previewState.done && previewState.error}
        <p class="mt-2 flex items-start gap-1.5 rounded-box border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
          <CircleAlert class="mt-0.5 size-3 shrink-0" />
          <span class="break-all">{previewState.error}</span>
        </p>
      {:else if previewState.done}
        <p class="mt-2 flex items-center gap-1.5 text-xs font-medium text-mint">
          <Check class="size-3" />
          Endpoint reachable — {previewState.models.length} models available
        </p>
        {#if previewState.models.length > 0}
          <div class="mt-1.5 flex max-h-[100px] flex-wrap gap-1 overflow-y-auto">
            {#each previewState.models.slice(0, 24) as m (m)}
              <span class="badge badge-sm border-line font-mono">{m}</span>
            {/each}
            {#if previewState.models.length > 24}<span class="self-center text-xs text-base-content/75">+{previewState.models.length - 24} more</span>{/if}
          </div>
        {/if}
      {:else}
        <p class="mt-2 text-xs text-base-content/75">Fill the URL and key, then test.</p>
      {/if}
    </div>
    {/if}

    {#if message}
      <Notice tone="error">{message}</Notice>
    {/if}

    <div class="flex items-center justify-end gap-2 border-t border-line pt-4 max-sm:flex-col-reverse max-sm:items-stretch">
      <button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
      <button class="btn btn-primary max-sm:btn-lg" type="submit" disabled={busy !== null}>
        {#if busy === "newp"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
        <span>Save connection</span>
      </button>
    </div>
  </form>
</Modal>
