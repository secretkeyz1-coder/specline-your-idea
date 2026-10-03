<script lang="ts">
  import { enhance } from "$app/forms";
  import { Terminal, Copy, Check, Laptop, Server, FolderGit2, Ban, ChevronDown } from "lucide-svelte";
  import type { MachineRow } from "$lib/types.js";
  import Notice from "$lib/components/Notice.svelte";
  import { linksByMachine, type MachineRepoLink } from "./links.js";
  import type { CliInstall } from "./+page.server.js";

  let {
    data,
    form,
  }: {
    data: { machines: MachineRow[]; links: MachineRepoLink[]; linksError: string | null; cli: CliInstall | null };
    form: { linkId?: string; notice?: string; message?: string } | null;
  } = $props();

  let copiedIdx = $state<number | string | null>(null);
  // Phones: the setup steps fold into a disclosure once machines are listed.
  let setupOpen = $state(false);
  let copyError = $state<string | null>(null);

  const onlineMachines = $derived(data.machines.filter((m) => m.status === "ONLINE"));
  // Offline (not revoked) machines: the ones a single command brings back.
  const reconnectable = $derived(data.machines.filter((m) => m.status !== "ONLINE" && m.status !== "REVOKED"));
  const linksOf = $derived(linksByMachine(data.links));
  // With nothing connected yet the setup steps are the page, in one column.
  const hasMachines = $derived(data.machines.length > 0 || !!data.linksError);

  type Review = "auto" | "human";
  /** Unsaved choices per link; the saved value comes from the server. */
  let choice = $state<Record<string, Review>>({});
  let saving = $state<string | null>(null);
  const saved = (row: MachineRepoLink): Review => (row.auto_approve ? "auto" : "human");
  const selected = (row: MachineRepoLink): Review => choice[row.link.id] ?? saved(row);

  // Fixed locale + zone so the server-rendered and hydrated strings match.
  const seenFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  // The details stay as tooltips: the steps themselves are the short version.
  // The CLI is served by this server: one command installs it (a coding agent runs it on its own).
  const STEPS = $derived([
    {
      title: "Install the CLI",
      detail: data.cli?.install
        ? `Needs Node.js 18+ or Bun. macOS, Linux and Git Bash; on Windows PowerShell: ${data.cli.install.ps1}`
        : "This server could not offer the installer right now — try again shortly.",
      command: data.cli?.install.sh ?? "sddctl --version",
    },
    {
      title: "Sign the CLI in",
      detail: "Starts a device login: your browser opens here and you approve it.",
      command: "sddctl login",
    },
    {
      title: "Link your repository",
      detail: "Run inside the Git working copy of the project; use the project key shown in the header.",
      command: "sddctl project link <project-key>",
    },
    {
      title: "Run an agent",
      optional: true,
      detail: "The agent connects out to this server and picks up work orders automatically — no port on your machine is opened.",
      command: "sdd-agent connect",
    },
  ]);

  async function copyCommand(cmd: string, idx: number | string) {
    copyError = null;
    try {
      await navigator.clipboard.writeText(cmd);
      copiedIdx = idx;
      setTimeout(() => (copiedIdx = null), 1600);
    } catch {
      copyError = "Your browser blocked clipboard access — select the command and copy it by hand.";
    }
  }

  function getPlatformIcon(platform: string) {
    if (platform.includes("win") || platform.includes("darwin") || platform.includes("mac")) return Laptop;
    return Server;
  }
</script>

<svelte:head>
  <title>Machines — SDD Control Plane</title>
</svelte:head>

<main
  class="mx-auto grid w-full content-start gap-8 px-4 pt-6 pb-20 sm:px-6 sm:pt-10 lg:px-10 {hasMachines
    ? 'max-w-[1380px] lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-10'
    : 'max-w-[800px]'}"
>
  <!-- Main column: state first, the one decision last -->
  <div class="flex min-w-0 flex-col gap-7 sm:gap-8">
    <header class="flex flex-col gap-2">
      <h1 class="text-[28px] font-extrabold tracking-tight text-balance sm:text-[32px]">
        <!-- Green only for machines that are really online. -->
        {#if data.machines.length === 0}No machines connected.
        {:else if onlineMachines.length === 0}{data.machines.length === 1 ? "Your machine is offline." : `None of your ${data.machines.length} machines is online.`}
        {:else}{onlineMachines.length} of {data.machines.length}
          {data.machines.length === 1 ? "machine is" : "machines are"} <span class="text-mint">online</span>.{/if}
      </h1>
      {#if data.machines.length === 0}
        <p class="max-w-[60ch] text-[14px] text-base-content/80">Optional — any task's work order can be copied into an agent by hand.</p>
      {:else if reconnectable.length > 0}
        <p class="max-w-[60ch] text-[14px] text-base-content/80">
          Agents pick up work only on an online machine. Reconnect {reconnectable.length === 1 ? "it" : "one"} by running <span class="font-mono">sdd-agent connect</span> on it.
        </p>
      {/if}
    </header>

    {#if data.machines.length > 0 || data.linksError}
      <section class="flex flex-col gap-3" aria-labelledby="links-heading">
        <h2 id="links-heading" class="text-[16px] font-semibold">Your machines</h2>

        {#if data.linksError}
          <Notice tone="error">{data.linksError}</Notice>
        {/if}

        {#each data.machines as machine (machine.id)}
          {@const Icon = getPlatformIcon(machine.platform.toLowerCase())}
          {@const rows = linksOf.get(machine.id) ?? []}
          {@const online = machine.status === "ONLINE"}
          <article class="card overflow-hidden border border-line bg-base-100" aria-labelledby={`machine-${machine.id}`}>
            <div class="flex items-center gap-3.5 px-4 py-4 sm:px-5 {rows.length || (!online && machine.status !== 'REVOKED') ? 'border-b border-line' : ''}">
              <span class="grid size-10 shrink-0 place-items-center rounded-[0.75rem] border border-line bg-base-200" aria-hidden="true">
                <Icon class="size-4 {online ? 'text-base-content' : 'text-base-content/80'}" />
              </span>
              <div class="min-w-0 flex-1">
                <!-- Names may wrap once: a truncated name is the one thing that tells two machines apart. -->
                <h3 id={`machine-${machine.id}`} class="line-clamp-2 text-[15px] font-semibold break-words text-base-content" title={machine.name}>{machine.name}</h3>
                <p class="truncate text-xs text-base-content/75">
                  <span class="font-mono">{machine.platform}</span>
                  <span aria-hidden="true"> · </span>
                  {#if machine.lastSeenAt}
                    Last seen <time datetime={machine.lastSeenAt} class="tabular-nums">{seenFormat.format(new Date(machine.lastSeenAt))} UTC</time>
                  {:else}
                    Never seen
                  {/if}
                </p>
              </div>
              {#if online}
                <span class="badge badge-sm shrink-0 gap-1.5 border-mint/40 bg-mint-soft font-semibold text-mint">
                  <span class="size-1.5 rounded-full bg-mint" aria-hidden="true"></span>Online
                </span>
              {:else if machine.status === "REVOKED"}
                <span class="badge badge-sm shrink-0 gap-1.5 border-danger/40 bg-danger-soft font-semibold text-danger">
                  <Ban class="size-3" aria-hidden="true" />Revoked
                </span>
              {:else}
                <span class="badge badge-sm shrink-0 gap-1.5 border-line bg-base-200 font-semibold text-base-content/80">
                  <span class="size-1.5 rounded-full bg-line-control" aria-hidden="true"></span>{machine.status === "OFFLINE" ? "Offline" : machine.status.charAt(0) + machine.status.slice(1).toLowerCase()}
                </span>
              {/if}
            </div>

            {#if !online && machine.status !== "REVOKED"}
              <!-- How to bring it back, on the card itself rather than only in "Connect a machine". -->
              <div class="flex flex-col gap-1.5 bg-base-200/60 px-4 py-3 sm:px-5 {rows.length ? 'border-b border-line' : ''}">
                <p class="text-xs text-base-content/80">To reconnect, run this on <span class="font-medium text-base-content">{machine.name}</span>:</p>
                <div class="flex items-center gap-2 rounded-[0.75rem] bg-base-300 py-1 ps-3 pe-1">
                  <code class="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-base-content"><span class="text-base-content/75" aria-hidden="true">{"$ "}</span>sdd-agent connect</code>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-square shrink-0"
                    onclick={() => copyCommand("sdd-agent connect", `machine-${machine.id}`)}
                    aria-label={copiedIdx === `machine-${machine.id}` ? "Copied: sdd-agent connect" : "Copy command: sdd-agent connect"}
                  >
                    {#if copiedIdx === `machine-${machine.id}`}<Check class="size-3.5 text-mint" aria-hidden="true" />{:else}<Copy class="size-3.5" aria-hidden="true" />{/if}
                  </button>
                </div>
              </div>
            {/if}

            {#each rows as row, ri (row.link.id)}
              {@const current = selected(row)}
              {@const editable = row.can_change_mode && row.link.status === "ACTIVE"}
              {@const dirty = current !== saved(row)}
              <form
                method="post"
                action="?/setReview"
                class="flex flex-col gap-3.5 px-4 py-3.5 sm:px-5 {ri < rows.length - 1 ? 'border-b border-line' : ''} {dirty ? 'bg-base-200' : ''}"
                use:enhance={() => {
                  saving = row.link.id;
                  return async ({ result, update }) => {
                    saving = null;
                    if (result.type === "success") delete choice[row.link.id];
                    await update({ reset: false });
                  };
                }}
              >
                <input type="hidden" name="link_id" value={row.link.id} />
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <FolderGit2 class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold text-base-content">
                      <span class="min-w-0 truncate">{row.project.name}</span>
                      {#if dirty}<span class="badge badge-sm border-warn/40 bg-warn-soft font-semibold text-warn">Unsaved</span>{/if}
                    </p>
                    <p class="truncate font-mono text-xs text-base-content/75" title={row.link.displayPath}>{row.project.key} · {row.link.displayPath}</p>
                  </div>
                  {#if row.link.status === "REVOKED"}
                    <!-- A revoked machine says so once, on its card; its links don't repeat it. -->
                    {#if machine.status !== "REVOKED"}
                      <span class="badge badge-sm shrink-0 gap-1.5 border-danger/40 bg-danger-soft font-semibold text-danger"><Ban class="size-3" aria-hidden="true" />Revoked</span>
                    {/if}
                  {:else if editable}
                    <!-- A setting, not a status: neutral while the machine is offline, so it never outshines "Offline". -->
                    <fieldset class="join shrink-0 max-sm:w-full" disabled={saving === row.link.id}>
                      <legend class="sr-only">Review for {row.project.key} on {machine.name}</legend>
                      <label class="btn btn-sm join-item gap-2 font-medium max-sm:h-11 max-sm:flex-1 {current === 'human' ? (online ? 'btn-active' : 'border-line-control bg-base-300') : ''}" title="Every run waits for a reviewer before its task is done.">
                        <input
                          class="radio radio-xs {online ? 'radio-primary' : ''}"
                          type="radio"
                          name="review"
                          value="human"
                          checked={current === "human"}
                          onchange={() => (choice[row.link.id] = "human")}
                        />Human review
                      </label>
                      <label class="btn btn-sm join-item gap-2 font-medium max-sm:h-11 max-sm:flex-1 {current === 'auto' ? (online ? 'btn-active' : 'border-line-control bg-base-300') : ''}" title="Runs whose required checks pass are approved without a reviewer; high-risk tasks still wait for one.">
                        <input
                          class="radio radio-xs {online ? 'radio-primary' : ''}"
                          type="radio"
                          name="review"
                          value="auto"
                          checked={current === "auto"}
                          onchange={() => (choice[row.link.id] = "auto")}
                        />Auto-approve
                      </label>
                    </fieldset>
                  {:else}
                    <span class="badge badge-sm shrink-0 border-line bg-base-200 font-semibold text-base-content/80" title={`Only an admin of ${row.project.key} can change this.`}>
                      {row.auto_approve ? "Auto-approve" : "Human review"}<span class="sr-only"> — only an admin of {row.project.key} can change this</span>
                    </span>
                  {/if}
                </div>

                {#if editable && dirty}
                  <!-- An unsaved change: say what will happen, then the one action -->
                  <div class="flex flex-col gap-3 sm:ms-7.5">
                    <Notice tone="warn">
                      {current === "auto"
                        ? "Tasks that pass every required check will be approved without a reviewer. High-risk tasks still wait."
                        : "Every run will wait for a reviewer before its task is done."}
                    </Notice>
                    <div class="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
                      <button type="button" class="btn btn-ghost max-sm:w-full" onclick={() => delete choice[row.link.id]} disabled={saving === row.link.id}>
                        {current === "auto" ? "Keep human review" : "Keep auto-approve"}
                      </button>
                      <button type="submit" class="btn btn-primary max-sm:btn-lg max-sm:w-full" disabled={saving === row.link.id} aria-busy={saving === row.link.id}>
                        {#if saving === row.link.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Saving…
                        {:else}{current === "auto" ? "Turn on auto-approve" : "Switch to human review"}{/if}
                      </button>
                    </div>
                  </div>
                {/if}
                {#if form?.linkId === row.link.id && (form.notice || form.message)}
                  <Notice tone={form.message ? "error" : "success"}>{form.message ?? form.notice}</Notice>
                {/if}
              </form>
            {/each}
          </article>
        {/each}
      </section>
    {/if}
  </div>

  <!-- How to connect a machine: reference, quieter -->
  <aside class="card flex flex-col gap-4.5 self-start border border-line bg-base-100 p-5 sm:p-6 {hasMachines ? 'max-sm:gap-0 max-sm:p-0' : ''}" aria-labelledby="setup-heading">
    <div class="flex items-center gap-2">
      <Terminal class="size-3.5 text-base-content/80 {hasMachines ? 'max-sm:hidden' : ''}" aria-hidden="true" />
      <h2 id="setup-heading" class="text-[16px] font-semibold text-base-content max-sm:grow">
        {#if hasMachines}
          <!-- Phones: the reference folds away below the machines. -->
          <button
            type="button"
            class="flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 text-left text-[14px] sm:hidden"
            aria-expanded={setupOpen}
            aria-controls="setup-steps"
            onclick={() => (setupOpen = !setupOpen)}
          >
            <Terminal class="size-4 shrink-0 text-base-content/80" aria-hidden="true" />
            <span class="grow">Connect a machine</span>
            <ChevronDown class="size-4 shrink-0 text-base-content/80 transition-transform {setupOpen ? 'rotate-180' : ''}" aria-hidden="true" />
          </button>
          <span class="max-sm:hidden">Connect a machine</span>
        {:else}
          Connect a machine
        {/if}
      </h2>
    </div>

    <div id="setup-steps" class="contents {hasMachines ? (setupOpen ? 'max-sm:flex max-sm:flex-col max-sm:gap-4.5 max-sm:border-t max-sm:border-line max-sm:p-4' : 'max-sm:hidden') : ''}">
    <ol class="relative flex flex-col gap-4.5">
      <span class="absolute start-[10px] top-3 bottom-3 w-0.5 rounded-full bg-line" aria-hidden="true"></span>
      {#each STEPS as step, i (step.command)}
        <li class="relative grid grid-cols-[22px_minmax(0,1fr)] gap-3">
          <span class="inline-grid size-5.5 place-items-center rounded-full border border-line-control bg-base-100 text-xs font-bold text-base-content/75" aria-hidden="true">{i + 1}</span>
          <div class="flex min-w-0 flex-col gap-1.5">
            <p class="text-[13px] font-semibold text-base-content" title={step.detail}>
              <span class="sr-only">Step {i + 1}: </span>{step.title}{#if step.optional}<span class="font-medium text-base-content/75">{" · optional"}</span>{/if}
            </p>
            <div class="flex items-center gap-2 rounded-[0.75rem] bg-base-300 py-1 ps-3 pe-1">
              <code class="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-base-content"><span class="text-base-content/75" aria-hidden="true">{"$ "}</span>{step.command}</code>
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-square shrink-0"
                onclick={() => copyCommand(step.command, i)}
                aria-label={copiedIdx === i ? `Copied: ${step.command}` : `Copy command: ${step.command}`}
              >
                {#if copiedIdx === i}<Check class="size-3.5 text-mint" aria-hidden="true" />{:else}<Copy class="size-3.5" aria-hidden="true" />{/if}
              </button>
            </div>
          </div>
        </li>
      {/each}
    </ol>
    {#if copyError}
      <Notice tone="error">{copyError}</Notice>
    {/if}
    </div>
  </aside>
</main>
