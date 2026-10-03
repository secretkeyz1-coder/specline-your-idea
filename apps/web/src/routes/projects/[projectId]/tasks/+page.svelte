<script lang="ts">
  import { enhance, deserialize } from "$app/forms";
  import {
    CircleCheck,
    Pencil,
    RefreshCcw,
    Scissors,
    TriangleAlert,
    Search,
    Filter,
    ArrowUpDown,
    ChevronDown,
    ChevronRight,
    X,
    ClipboardList,
    Check,
    Ellipsis,
    Gauge,
    Network,
    Monitor,
  } from "lucide-svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Dropdown from "$lib/components/ui/Dropdown.svelte";
  import type { TaskSummary } from "$lib/types.js";
  import { hardnessTitle, hardnessWord } from "$lib/labels.js";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import Notice from "$lib/components/Notice.svelte";

  let {
    data,
    form,
  }: {
    data: {
      tasks: TaskSummary[];
      graph: { acyclic: boolean; cycle?: string[] };
      promptOptions: { self_connect: boolean; auto_approve: boolean };
    };
    form: {
      ok?: boolean;
      notice?: string;
      message?: string;
      checks?: Array<{ label: string; detail: string }>;
    } | null;
  } = $props();

  let busy = $state<string | null>(null);
  let showGraph = $state(false);
  let moreOpen = $state(false);
  let promptCopied = $state(false);
  /** Admin choice baked into the prompt's connect code. */
  let promptAutoApprove = $state(false);

  // Filter & Search states
  let searchQuery = $state("");
  let statusFilter = $state<string>("ALL");
  let typeFilter = $state<string>("ALL");
  let sortAsc = $state(true);
  let confirmRegenerate = $state(false);

  /** Approving runs the readiness checks first; the button says so on hover. */
  const APPROVE_HINT =
    "Approving checks each task first: it traces back to a requirement, lists the commands that verify it, has no dependency loop, and was built from the current specs.";

  // The list is grouped by who holds the task: you, an agent, nobody yet, or
  // it is finished. Filters map to the same REAL workflow statuses.
  const NEEDS_YOU = ["DRAFT", "NEEDS_REVIEW"];
  const WITH_AGENT = ["CLAIMED", "IN_PROGRESS", "VALIDATING", "CHANGES_REQUESTED", "BLOCKED"];

  const drafts = $derived(data.tasks.filter((t) => t.workflowStatus === "DRAFT"));
  const needYouCount = $derived(data.tasks.filter((t) => NEEDS_YOU.includes(t.workflowStatus)).length);
  const blockedCount = $derived(data.tasks.filter((t) => t.workflowStatus === "BLOCKED").length);
  const done = $derived(data.tasks.filter((t) => t.workflowStatus === "DONE"));
  const liveTotal = $derived(data.tasks.filter((t) => t.workflowStatus !== "CANCELLED").length);

  const STATUS_FILTERS = $derived<Array<{ id: string; label: string; statuses: string[] | null }>>([
    { id: "ALL", label: "All", statuses: null },
    { id: "NEEDS_YOU", label: "Needs you", statuses: NEEDS_YOU },
    { id: "ACTIVE", label: "In progress", statuses: WITH_AGENT },
    { id: "READY", label: "Ready", statuses: ["READY"] },
    // Blocked work is inside "In progress"; its own chip appears only when there is some.
    ...(blockedCount > 0 || statusFilter === "BLOCKED" ? [{ id: "BLOCKED", label: "Blocked", statuses: ["BLOCKED"] }] : []),
    { id: "DONE", label: "Done", statuses: ["DONE"] },
  ]);

  // Draft-action disclosure (docs/14 §11) — one row at a time. Edit and split
  // sit in the row's "…" menu; Approve is the one action on the row itself.
  let editingId = $state<string | null>(null);
  let splittingId = $state<string | null>(null);
  let rowMenu = $state<string | null>(null);

  // Unique task types in this project
  const availableTypes = $derived(
    Array.from(new Set(data.tasks.map((t) => t.taskType))).filter(Boolean),
  );

  // Filtered & Sorted tasks
  const filteredTasks = $derived.by(() => {
    let list = data.tasks;

    const statuses = STATUS_FILTERS.find((f) => f.id === statusFilter)?.statuses ?? null;
    if (statuses) {
      list = list.filter((t) => statuses.includes(t.workflowStatus));
    }

    if (typeFilter !== "ALL") {
      list = list.filter((t) => t.taskType === typeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.key.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.taskType.toLowerCase().includes(q) ||
          t.priority.toLowerCase().includes(q),
      );
    }

    return [...list].sort((a, b) => {
      const cmp = a.key.localeCompare(b.key, undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  });

  const groups = $derived([
    { id: "you", label: "Needs you", tasks: filteredTasks.filter((t) => NEEDS_YOU.includes(t.workflowStatus)) },
    { id: "agent", label: "With an agent", tasks: filteredTasks.filter((t) => WITH_AGENT.includes(t.workflowStatus)) },
    { id: "ready", label: "Ready", tasks: filteredTasks.filter((t) => t.workflowStatus === "READY") },
  ]);
  const doneShown = $derived(filteredTasks.filter((t) => t.workflowStatus === "DONE"));
  const cancelledShown = $derived(filteredTasks.filter((t) => t.workflowStatus === "CANCELLED"));
  // Finished work folds away unless it is what the user asked for.
  const foldOpen = $derived(statusFilter === "DONE" || searchQuery.trim() !== "");

  // Why a draft cannot be approved yet: its first failing readiness check, in
  // its own words. (This looked for a "deps" check that readiness never
  // reports, so no draft ever said why it was stuck.)
  function getBlockerDetail(task: TaskSummary): string | null {
    if (task.workflowStatus !== "DRAFT") return null;
    const checks = task.readinessReport?.checks;
    if (!checks || !Array.isArray(checks)) return null;
    const failing = checks.find((c) => !c.ok);
    return failing ? (failing.detail || `${failing.label} not met`) : null;
  }
  const needsRenderCheck = (task: TaskSummary) => (task.lintFindings ?? []).some((f) => f.id === "no_render_check");

  let promptError = $state<string | null>(null);

  async function copyExecutionPrompt() {
    busy = "prompt";
    try {
      const res = await fetch("?/executionPrompt", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams(promptAutoApprove && data.promptOptions.auto_approve ? { auto_approve: "on" } : {}),
      });
      const result = deserialize<{ prompt?: string }, { message?: string }>(await res.text());
      const prompt = result.type === "success" ? result.data?.prompt : undefined;
      if (prompt) {
        try {
          await navigator.clipboard.writeText(prompt);
          promptCopied = true;
          promptError = null;
          setTimeout(() => (promptCopied = false), 2500);
        } catch {
          promptError = "Your browser blocked clipboard access. Allow it for this site, or use the prompt on each task page.";
        }
      } else {
        promptError = result.type === "failure" ? (result.data?.message ?? "The prompt could not be generated.") : "The prompt could not be generated.";
      }
    } catch {
      promptError = "The prompt could not be generated — check your connection and try again.";
    } finally {
      busy = null;
    }
  }
</script>

<!-- Copy the one prompt that hands every ready task to a local agent. -->
{#snippet promptControls(primary: boolean)}
  <button
    class="btn {primary ? 'btn-primary max-sm:btn-lg max-sm:order-first max-sm:grow' : 'btn-ghost btn-sm w-full justify-start text-[13px] font-normal'}"
    type="button"
    onclick={copyExecutionPrompt}
    disabled={busy !== null}
    aria-busy={busy === "prompt"}
    aria-live="polite"
  >
    {#if busy === "prompt"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
    {:else if promptCopied}<Check class="size-4 {primary ? '' : 'text-mint'}" aria-hidden="true" />
    {:else}<ClipboardList class="size-4" aria-hidden="true" />{/if}
    <span>{busy === "prompt" ? "Preparing…" : promptCopied ? "Copied" : "Copy agent prompt"}</span>
  </button>
  {#if data.promptOptions.auto_approve}
    <label
      class="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-base-content/80 {primary ? '' : 'px-3'}"
      title="The copied prompt connects the agent's machine with auto-approve: runs whose required checks pass are approved without a reviewer."
    >
      <input type="checkbox" class="checkbox checkbox-sm" bind:checked={promptAutoApprove} disabled={busy !== null} />
      Auto-approve
    </label>
  {/if}
{/snippet}

{#snippet taskRow(task: TaskSummary)}
  {@const blocker = getBlockerDetail(task)}
  {@const status = task.workflowStatus}
  {@const hasActions = status === "DRAFT" || status === "NEEDS_REVIEW" || status === "BLOCKED"}
  <li class="border-b border-line last:border-b-0">
    <!-- Phones: one tappable row — key, status, hardness word; the title below; the action (or a chevron) at the end. -->
    <div
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-base-200/60 max-sm:relative max-sm:min-h-[68px] max-sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] max-sm:gap-x-2 max-sm:py-2.5 sm:px-6 md:min-h-[52px] md:grid-cols-[104px_minmax(0,1fr)_104px_112px_188px] md:gap-x-4 md:py-2"
    >
      <span class="col-start-1 row-start-1 font-mono text-xs font-medium tracking-tight text-base-content">{task.key}</span>

      <div class="col-span-2 row-start-2 min-w-0 max-sm:col-span-3 md:col-span-1 md:col-start-2 md:row-start-1">
        <a
          class="block text-[14px] leading-snug font-semibold text-base-content hover:underline max-sm:after:absolute max-sm:after:inset-0 max-sm:hover:no-underline md:truncate md:text-[13px]"
          href={`tasks/${task.id}`}
          title={task.title}
        >
          {task.title}
        </a>
        {#if blocker}
          <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-warn" title={blocker}>
            <TriangleAlert class="size-3 shrink-0" aria-hidden="true" />
            <span id={`blocker-${task.id}`} class="truncate">{blocker}</span>
          </p>
        {/if}
      </div>

      <!-- Hardness: always its word, with the explanation on hover. -->
      <span
        class="col-span-2 row-start-3 flex items-center gap-1.5 text-xs text-base-content/75 max-sm:col-span-1 max-sm:col-start-3 max-sm:row-start-1 max-sm:min-w-0 md:col-span-1 md:col-start-3 md:row-start-1"
        title={hardnessTitle(task.hardness)}
      >
        <Gauge class="size-3 shrink-0 max-sm:hidden" aria-hidden="true" />
        <span class="sr-only">Hardness:</span>{hardnessWord(task.hardness)}
      </span>

      <span class="col-start-2 row-start-1 justify-self-end max-sm:justify-self-start md:col-start-4 md:justify-self-start">
        <StatusBadge status={status} />
      </span>

      {#if hasActions}
        <div
          class="col-span-2 row-start-4 flex items-center gap-1 max-sm:relative max-sm:z-[1] {status === 'DRAFT'
            ? 'max-sm:col-span-full max-sm:row-start-3'
            : 'max-sm:col-span-1 max-sm:col-start-4 max-sm:row-span-2 max-sm:row-start-1'} md:col-span-1 md:col-start-5 md:row-start-1 md:justify-end"
        >
          {#if status === "DRAFT"}
            <form
              method="post"
              action="?/ready"
              use:enhance={() => {
                busy = task.id;
                return async ({ update }) => {
                  busy = null;
                  await update();
                };
              }}
            >
              <input type="hidden" name="taskId" value={task.id} />
              <button
                class="btn btn-outline btn-sm border-line-control"
                type="submit"
                disabled={busy !== null}
                title={APPROVE_HINT}
                aria-describedby={blocker ? `blocker-${task.id}` : undefined}
              >
                {#if busy === task.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                Approve<span class="sr-only"> {task.key}</span>
              </button>
            </form>
            <Dropdown
              bind:open={() => rowMenu === task.id, (v) => (rowMenu = v ? task.id : rowMenu === task.id ? null : rowMenu)}
              align="end"
              class="w-56 rounded-box border border-line bg-base-100 p-1.5 text-[13px] shadow-xl"
            >
              {#snippet trigger(props)}
                <button type="button" {...props} class="btn btn-sm btn-ghost btn-square text-base-content/80 hover:text-base-content" title="More for this draft">
                  <Ellipsis class="size-4" aria-hidden="true" /><span class="sr-only">More for {task.key}</span>
                </button>
              {/snippet}
              <ul class="menu w-full p-0">
                {#if needsRenderCheck(task)}
                  <li>
                    <form
                      method="post"
                      action="?/renderCheck"
                      class="contents"
                      use:enhance={() => {
                        rowMenu = null;
                        busy = task.id;
                        return async ({ update }) => {
                          busy = null;
                          await update();
                        };
                      }}
                    >
                      <input type="hidden" name="taskId" value={task.id} />
                      <button type="submit" disabled={busy !== null} title="Adds a Playwright check that opens the screen at 1280 and 360 px">
                        <Monitor class="size-4" aria-hidden="true" />Add render check
                      </button>
                    </form>
                  </li>
                {/if}
                <li>
                  <button type="button" onclick={() => { rowMenu = null; splittingId = null; editingId = task.id; }}>
                    <Pencil class="size-4" aria-hidden="true" />Edit title and objective
                  </button>
                </li>
                <li>
                  <button type="button" onclick={() => { rowMenu = null; editingId = null; splittingId = task.id; }}>
                    <Scissors class="size-4" aria-hidden="true" />Split into smaller parts
                  </button>
                </li>
              </ul>
            </Dropdown>
          {:else if status === "NEEDS_REVIEW"}
            <a class="btn btn-outline btn-sm border-line-control" href={`tasks/${task.id}`}>Review<span class="sr-only"> {task.key}</span></a>
          {:else}
            <a class="btn btn-ghost btn-sm" href={`tasks/${task.id}`}>See why<span class="sr-only"> {task.key} is blocked</span></a>
          {/if}
        </div>
      {:else}
        <ChevronRight class="col-start-4 row-span-2 row-start-1 size-4 text-base-content/60 sm:hidden" aria-hidden="true" />
      {/if}
    </div>

    <!-- Inline edit (drafts only) -->
    {#if editingId === task.id}
      <form
        method="post"
        action="?/edit"
        use:enhance={() => {
          busy = task.id;
          return async ({ update }) => {
            busy = null;
            editingId = null;
            await update();
          };
        }}
        class="mx-4 mb-3 flex flex-col gap-2 rounded-box border border-line bg-base-200 p-3 sm:mx-6"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <input
          class="input input-sm w-full"
          type="text"
          name="title"
          value={task.title}
          aria-label={`New title for ${task.key}`}
          maxlength="200"
        />
        <textarea
          class="textarea textarea-sm min-h-[56px] w-full"
          name="objective"
          aria-label={`New objective for ${task.key}`}
          placeholder="Objective (leave blank to keep)"
        ></textarea>
        <div class="flex justify-end gap-1.5">
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => (editingId = null)}>Cancel</button>
          <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={busy !== null}>Save changes</button>
        </div>
      </form>
    {/if}

    <!-- Inline split (drafts only) -->
    {#if splittingId === task.id}
      <form
        method="post"
        action="?/split"
        use:enhance={() => {
          busy = task.id;
          return async ({ update }) => {
            busy = null;
            splittingId = null;
            await update();
          };
        }}
        class="mx-4 mb-3 flex flex-col gap-2 rounded-box border border-line bg-base-200 p-3 sm:mx-6"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <div class="grid gap-2 lg:grid-cols-3">
          {#each [0, 1, 2] as i}
            <fieldset class="flex flex-col gap-1.5 rounded-box border border-line bg-base-100 p-2.5">
              <legend class="px-1 text-xs font-semibold text-base-content/80">Part {i + 1}{i > 1 ? " (optional)" : ""}</legend>
              <input class="input input-sm w-full" type="text" name="part_title" aria-label={`Part ${i + 1} title`} placeholder="Title" maxlength="200" />
              <input class="input input-sm w-full" type="text" name="part_objective" aria-label={`Part ${i + 1} objective`} placeholder="Objective" maxlength="500" />
              <input
                class="input input-sm w-full"
                type="text"
                name={`part_ac_${i}`}
                aria-label={`Part ${i + 1} acceptance criterion`}
                placeholder="Acceptance criterion"
                maxlength="400"
              />
            </fieldset>
          {/each}
        </div>
        <div class="flex justify-end gap-1.5">
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => (splittingId = null)}>Cancel</button>
          <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={busy !== null}>Split draft</button>
        </div>
      </form>
    {/if}
  </li>
{/snippet}

{#snippet foldedGroup(label: string, list: TaskSummary[])}
  <details class="group border-t border-line first:border-t-0" open={foldOpen}>
    <summary class="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
      <ChevronDown class="size-4 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
      {label}
      <span class="font-normal tabular-nums text-base-content/75">{list.length}</span>
    </summary>
    <ul class="border-t border-line">
      {#each list as task (task.id)}
        {@render taskRow(task)}
      {/each}
    </ul>
  </details>
{/snippet}

<main class="flex flex-col gap-6 sm:gap-7">
  {#if form?.notice}
    <Notice tone="success">{form.notice}</Notice>
  {:else if form?.message}
    <Notice tone="error">
      <span class="font-semibold">{form.message}</span>
      {#if form.checks?.length}
        <ul class="mt-1.5 list-disc space-y-0.5 pl-4">
          {#each form.checks as check}
            <li>
              <span class="font-semibold">{check.label}</span>
              {#if check.detail}<span> — {check.detail}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Notice>
  {/if}

  {#if data.tasks.length === 0}
    <!-- No tasks yet: the one way forward. -->
    <section class="flex flex-col items-start gap-4">
      <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-base-content sm:text-[32px]">
        Cut the design into tasks.
      </h1>
      <p class="text-[13px] text-base-content/80">Needs an approved design.</p>
      <form
        method="post"
        action="?/generate"
        use:enhance={() => {
          busy = "generate-empty";
          return async ({ update }) => {
            busy = null;
            await update();
          };
        }}
      >
        <button class="btn btn-primary btn-lg" type="submit" disabled={busy !== null} aria-busy={busy === "generate-empty"}>
          {#if busy === "generate-empty"}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Generating tasks…{:else}Generate tasks{/if}
        </button>
      </form>
      <AiProgress active={busy === "generate-empty"} label="Generating tasks" estimate="about two minutes" />
    </section>
  {:else}
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
          {#if liveTotal > 0 && done.length === liveTotal}
            All {liveTotal} tasks <span class="text-primary-ink">done</span>.
          {:else}
            {done.length} of {liveTotal} done.{#if needYouCount > 0}{" "}{needYouCount} {needYouCount === 1 ? "needs" : "need"} you.{/if}
          {/if}
        </h1>
        {#if !data.graph.acyclic}
          <p class="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-danger">
            <TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
            Dependency loop found
            <button type="button" class="btn btn-ghost btn-sm font-semibold" aria-expanded={showGraph} onclick={() => (showGraph = !showGraph)}>
              {showGraph ? "Hide loop" : "Show loop"}
            </button>
          </p>
        {/if}
      </div>

      <!-- One primary action for the current state; the rest under "More". With
           drafts waiting, the decision heads the "Needs you" group instead. -->
      <div class="flex flex-wrap items-center gap-2">
        <details class="dropdown dropdown-end" bind:open={moreOpen}>
          <summary class="btn btn-ghost list-none max-sm:h-12 [&::-webkit-details-marker]:hidden">
            More
            <ChevronDown class="size-4" aria-hidden="true" />
          </summary>
          <div class="dropdown-content z-20 mt-1.5 flex w-[290px] max-w-[calc(100vw-2rem)] max-sm:mb-1.5 flex-col gap-0.5 rounded-box border border-line bg-base-100 p-1.5 text-[13px] shadow-xl">
            {#if drafts.length > 0}
              {@render promptControls(false)}
            {/if}
            <button
              type="button"
              class="btn btn-ghost btn-sm w-full justify-start text-[13px] font-normal"
              onclick={() => {
                showGraph = !showGraph;
                moreOpen = false;
              }}
            >
              {#if data.graph.acyclic}<Network class="size-4" aria-hidden="true" />{:else}<TriangleAlert class="size-4 text-danger" aria-hidden="true" />{/if}
              {showGraph ? "Hide dependency check" : "Check dependencies"}
            </button>
            {#if !confirmRegenerate}
              <button
                type="button"
                class="btn btn-ghost btn-sm w-full justify-start text-[13px] font-normal"
                disabled={busy !== null}
                onclick={() => (confirmRegenerate = true)}
              >
                <RefreshCcw class="size-4" aria-hidden="true" />
                Generate tasks again…
              </button>
            {:else}
              <form
                method="post"
                action="?/generate"
                class="rounded-box border border-warn/40 bg-warn-soft p-3"
                use:enhance={() => {
                  busy = "gen";
                  return async ({ update }) => {
                    busy = null;
                    confirmRegenerate = false;
                    moreOpen = false;
                    await update();
                  };
                }}
              >
                <p class="text-[13px] leading-relaxed text-base-content">Adds a new set from the current design. Existing tasks stay.</p>
                <div class="mt-2 flex justify-end gap-1.5">
                  <button type="button" class="btn btn-sm btn-ghost" disabled={busy === "gen"} onclick={() => (confirmRegenerate = false)}>Keep current</button>
                  <button type="submit" class="btn btn-sm btn-outline border-line-control" disabled={busy !== null} aria-busy={busy === "gen"}>
                    {#if busy === "gen"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                    {busy === "gen" ? "Generating…" : "Generate again"}
                  </button>
                </div>
                <AiProgress active={busy === "gen"} label="Generating tasks" estimate="about two minutes" class="mt-2" />
              </form>
            {/if}
          </div>
        </details>

        {#if drafts.length === 0}
          {@render promptControls(true)}
        {/if}
      </div>
    </header>

    {#if promptError}
      <Notice tone="error">{promptError}</Notice>
    {/if}

    {#if showGraph}
      {#if data.graph.acyclic}
        <Notice tone="success">No dependency loops — all {data.tasks.length} tasks can run in order.</Notice>
      {:else}
        <Notice tone="error">These tasks wait on each other in a loop: {(data.graph.cycle ?? []).join(" → ")}. Remove one dependency to break it.</Notice>
      {/if}
    {/if}

    <!-- Search, status and type filters, sort -->
    <div class="flex flex-wrap items-center justify-between gap-2.5">
      <div class="flex min-w-0 flex-wrap items-center gap-2.5 max-sm:w-full max-sm:flex-nowrap max-sm:gap-2">
        <label class="input input-sm w-full max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 sm:w-[240px]">
          <Search class="size-4 shrink-0 text-base-content/75" aria-hidden="true" />
          <input bind:value={searchQuery} type="search" aria-label="Search tasks" placeholder="Search tasks" class="grow" />
          {#if searchQuery}
            <button type="button" onclick={() => (searchQuery = "")} class="btn btn-ghost btn-xs btn-square -me-1 text-base-content/80" aria-label="Clear search">
              <X class="size-3.5" aria-hidden="true" />
            </button>
          {/if}
        </label>

        <!-- More than three filters: a select-style button on phones. -->
        <label class="select w-auto shrink-0 max-sm:h-11 sm:hidden">
          <span class="sr-only">Filter by status</span>
          <select bind:value={statusFilter}>
            {#each STATUS_FILTERS as f (f.id)}
              <option value={f.id}>{f.label}</option>
            {/each}
          </select>
        </label>
        <div class="join max-w-full overflow-x-auto max-sm:hidden" role="group" aria-label="Filter by status">
          {#each STATUS_FILTERS as f (f.id)}
            <button
              type="button"
              class="btn btn-sm join-item border-line whitespace-nowrap {statusFilter === f.id ? 'btn-active' : 'bg-base-200 font-medium text-base-content/80'}"
              aria-pressed={statusFilter === f.id}
              onclick={() => (statusFilter = f.id)}
            >
              {f.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if availableTypes.length > 1}
          <label class="select select-sm w-auto max-sm:h-11">
            <Filter class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
            <select bind:value={typeFilter} aria-label="Filter by task type">
              {#each ["ALL", ...availableTypes] as t (t)}
                <option value={t}>{t === "ALL" ? "All types" : t}</option>
              {/each}
            </select>
          </label>
        {/if}
        <button
          type="button"
          onclick={() => (sortAsc = !sortAsc)}
          class="btn btn-sm btn-ghost text-base-content/80"
          aria-label={sortAsc ? "Sorted by key, first to last. Reverse order" : "Sorted by key, last to first. Reverse order"}
        >
          <ArrowUpDown class="size-3.5" aria-hidden="true" />
          <span>{sortAsc ? "Key 1→9" : "Key 9→1"}</span>
        </button>
      </div>
    </div>

    {#if filteredTasks.length === 0}
      <div class="card flex flex-col items-center gap-3 border border-line bg-base-100 p-10 text-center">
        <p class="text-[13px] text-base-content/80">No tasks match.</p>
        <button
          type="button"
          onclick={() => {
            searchQuery = "";
            statusFilter = "ALL";
            typeFilter = "ALL";
          }}
          class="btn btn-sm btn-outline border-line-control"
        >
          Clear filters
        </button>
      </div>
    {:else}
      <section class="card overflow-hidden border border-line bg-base-100" aria-label="Tasks">
        {#each groups as group (group.id)}
          {#if group.id === "you" && drafts.length > 0}
            <!-- The bulk decision heads the group it decides, on every width —
                 not at the end of a list that can run long. -->
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-base-200 px-4 py-2 sm:px-6">
              <h2 class="text-xs font-semibold text-base-content">
                {group.label}{#if group.tasks.length === 0}<span class="font-normal text-base-content/75"> · hidden by the filter</span>{/if}
              </h2>
              <form
                class="max-sm:w-full"
                method="post"
                action="?/readyAll"
                use:enhance={() => {
                  busy = "readyAll";
                  return async ({ update }) => {
                    busy = null;
                    await update();
                  };
                }}
              >
                <button class="btn btn-primary btn-sm max-sm:h-11 max-sm:w-full" type="submit" disabled={busy !== null} title={APPROVE_HINT}>
                  {#if busy === "readyAll"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<CircleCheck class="size-4" aria-hidden="true" />{/if}
                  <span>{busy === "readyAll" ? "Approving…" : drafts.length === 1 ? "Approve draft" : `Approve ${drafts.length} drafts`}</span>
                </button>
              </form>
            </div>
          {:else if group.tasks.length > 0}
            <h2 class="flex h-9 items-center border-b border-line bg-base-200 px-4 text-xs font-semibold text-base-content sm:px-6 [&:not(:first-child)]:border-t">
              {group.label}
            </h2>
          {/if}
          {#if group.tasks.length > 0}
            <ul>
              {#each group.tasks as task (task.id)}
                {@render taskRow(task)}
              {/each}
            </ul>
          {/if}
        {/each}
        {#if doneShown.length > 0}
          {@render foldedGroup("Done", doneShown)}
        {/if}
        {#if cancelledShown.length > 0}
          {@render foldedGroup("Cancelled", cancelledShown)}
        {/if}
      </section>
    {/if}
  {/if}
</main>
