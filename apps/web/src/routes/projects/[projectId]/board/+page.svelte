<script lang="ts">
  import { page } from "$app/state";
  import { invalidate } from "$app/navigation";
  import {
    ArrowRight,
    Radio,
    RefreshCw,
    Search,
    X,
    ChevronDown,
    ChevronRight,
    WifiOff,
    Gauge,
    TriangleAlert,
  } from "lucide-svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import BuildViews from "$lib/components/BuildViews.svelte";
  import { STATUS_META, type WorkflowStatus } from "$lib/status.js";
  import type { TaskSummary } from "$lib/types.js";
  import { throttle } from "$lib/throttle.js";
  import { hardnessTitle, hardnessWord } from "$lib/labels.js";

  let { data }: { data: { projectId: string; tasks: TaskSummary[] } } = $props();

  /** Work in flight, left to right. Rework and blocked cards sit in the
   *  "Needs attention" strip above; done cards fold into the Done column. */
  const ACTIVE_COLUMNS: WorkflowStatus[] = ["READY", "CLAIMED", "IN_PROGRESS", "VALIDATING", "NEEDS_REVIEW"];
  const ATTENTION_STATUSES: WorkflowStatus[] = ["CHANGES_REQUESTED", "BLOCKED"];

  type Connection = "connecting" | "live" | "paused";
  let connection = $state<Connection>("connecting");
  /** Bumped by "Reconnect": re-runs the effect, which opens a fresh EventSource. */
  let reconnects = $state(0);
  let filterQuery = $state("");
  let typeFilter = $state("ALL");

  // SSE invalidation stream: real-time live events from the API server.
  // Keyed on the project id (a reused component must follow a project switch),
  // and bursts of events are coalesced into one reload.
  $effect(() => {
    const projectId = data.projectId;
    const attempt = reconnects;
    connection = "connecting";
    const source = new EventSource(`/api/events/${projectId}`);
    let pending: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    // A finished task can move the project's next step (the header bar), but
    // the journey costs eight API reads: refresh it at most every 5 s, with a
    // trailing run so the last change still shows.
    const refreshJourney = throttle(() => void invalidate("app:journey"), 5000);

    const scheduleReload = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        // The board's own data, and (throttled) the journey — not auth or the project list.
        void invalidate("app:board");
        refreshJourney();
      }, 400);
    };
    const pause = () => {
      source.close();
      connection = "paused";
    };

    source.addEventListener("connected", () => {
      failures = 0;
      connection = "live";
      // After a manual reconnect, catch up on anything missed while paused.
      if (attempt > 0) scheduleReload();
    });
    source.addEventListener("update", (event) => {
      try {
        JSON.parse((event as MessageEvent).data);
      } catch {
        return; // malformed event: nothing to reload for
      }
      scheduleReload();
    });
    // Upstream ended (API restart, proxy closed): stop and let the user reconnect.
    source.addEventListener("stream_ended", pause);
    source.onerror = () => {
      // A non-200 answer (expired session, no access, API down) closes the
      // EventSource for good; otherwise it retries on its own for a while.
      failures += 1;
      if (source.readyState === EventSource.CLOSED || failures >= 3) pause();
      else connection = "connecting";
    };
    return () => {
      if (pending) clearTimeout(pending);
      refreshJourney.cancel();
      source.close();
    };
  });

  const availableTypes = $derived(
    Array.from(new Set(data.tasks.map((t) => t.taskType))).filter(Boolean),
  );

  const filterActive = $derived(typeFilter !== "ALL" || filterQuery.trim() !== "");

  const filteredTasks = $derived.by(() => {
    let list = data.tasks;
    if (typeFilter !== "ALL") {
      list = list.filter((t) => t.taskType === typeFilter);
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.key.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.taskType.toLowerCase().includes(q),
      );
    }
    return list;
  });

  const byStatus = $derived.by(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of filteredTasks) {
      const bucket = map.get(task.workflowStatus);
      if (bucket) bucket.push(task);
      else map.set(task.workflowStatus, [task]);
    }
    return map;
  });

  const attention = $derived(filteredTasks.filter((t) => ATTENTION_STATUSES.includes(t.workflowStatus as WorkflowStatus)));

  /** Most recently finished first (task rows carry updatedAt from the API). */
  const updatedAt = (t: TaskSummary) => (t as TaskSummary & { updatedAt?: string }).updatedAt ?? "";
  function newestFirst(list: TaskSummary[]): TaskSummary[] {
    return [...list].sort((a, b) => updatedAt(b).localeCompare(updatedAt(a)) || b.key.localeCompare(a.key, undefined, { numeric: true }));
  }
  const doneTasks = $derived(newestFirst(byStatus.get("DONE") ?? []));

  // Idle is judged on the whole board, not the filtered view.
  const allDone = $derived(data.tasks.filter((t) => t.workflowStatus === "DONE"));
  const inFlight = $derived(
    data.tasks.filter((t) => [...ACTIVE_COLUMNS, ...ATTENTION_STATUSES].includes(t.workflowStatus as WorkflowStatus)),
  );
  const idle = $derived(data.tasks.length > 0 && inFlight.length === 0);
  // Before the first claim every open card is Ready: five empty columns say
  // nothing. The board then shows the ready work orders and how to start.
  const notStarted = $derived(inFlight.length > 0 && allDone.length === 0 && inFlight.every((t) => t.workflowStatus === "READY"));
  const firstReady = $derived(
    [...inFlight].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))[0] ?? null,
  );

  const byKey = (a: TaskSummary, b: TaskSummary) => a.key.localeCompare(b.key, undefined, { numeric: true });
  // The headline names the one thing that needs the user, judged on the whole
  // board (not the filtered view); the primary action opens that card.
  const reviewTasks = $derived(data.tasks.filter((t) => t.workflowStatus === "NEEDS_REVIEW").sort(byKey));
  const attentionAll = $derived(
    data.tasks.filter((t) => ATTENTION_STATUSES.includes(t.workflowStatus as WorkflowStatus)).sort(byKey),
  );
  const target = $derived(reviewTasks[0] ?? attentionAll[0] ?? (notStarted ? firstReady : null));
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const taskHref = (task: TaskSummary) => `/projects/${data.projectId}/tasks/${task.id}`;
</script>

<!-- Phones: a card becomes a full-width tappable row with a chevron; inside a
     status group (row = true) it is one row of the grouped list. -->
{#snippet taskCard(task: TaskSummary, showStatus: boolean, row = false)}
  <a
    href={taskHref(task)}
    class="card flex flex-col gap-1.5 border bg-base-100 px-3.5 py-3 transition-colors max-sm:min-h-[60px] max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:py-2.5 {target?.id === task.id
      ? 'border-primary-ink'
      : 'border-line hover:border-line-control'} {row
      ? `max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line ${target?.id === task.id ? 'max-sm:shadow-[inset_3px_0_0_var(--color-primary-ink)]' : ''}`
      : ''}"
  >
    <span class="flex min-w-0 grow flex-col gap-1 sm:contents">
    <span class="flex items-center justify-between gap-2 max-sm:justify-start">
      <span class="font-mono text-xs font-semibold tracking-tight text-base-content">{task.key}</span>
      {#if showStatus}<StatusBadge status={task.workflowStatus} />{/if}
    </span>
    <span class="line-clamp-2 text-[13px] leading-snug font-semibold text-base-content max-sm:text-[14px]">{task.title}</span>
    <!-- Priority and hardness, quiet: hardness always as its word. -->
    <span class="flex items-center gap-1.5 text-xs text-base-content/75 max-sm:hidden">
      <span class="font-mono {task.priority === 'P0' ? 'font-semibold text-danger' : ''}">{task.priority}</span>
      <span aria-hidden="true">·</span>
      <span class="flex items-center gap-1" title={hardnessTitle(task.hardness)}>
        <Gauge class="size-3 shrink-0" aria-hidden="true" /><span class="sr-only">Hardness:</span>{hardnessWord(task.hardness)}
      </span>
    </span>
    </span>
    <ChevronRight class="size-4 shrink-0 text-base-content/60 sm:hidden" aria-hidden="true" />
  </a>
{/snippet}

{#snippet columnHeading(status: WorkflowStatus, count: number, id: string, cls = "")}
  {@const meta = STATUS_META[status]}
  {@const Icon = meta.icon}
  <!-- Phones: a group header of the one grouped list. -->
  <h3 {id} class="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-base-content max-sm:h-9 max-sm:gap-2 max-sm:bg-base-200 max-sm:px-3.5 {cls}">
    <Icon class="size-3.5 shrink-0 text-base-content/80" aria-hidden="true" />
    {meta.label}
    <span class="ml-auto font-medium tabular-nums text-base-content/75">
      {count}<span class="sr-only">{count === 1 ? " task" : " tasks"}</span>
    </span>
  </h3>
{/snippet}

{#snippet doneList(list: TaskSummary[])}
  <ul class="menu w-full p-0">
    {#each list as task (task.id)}
      <li>
        <a href={taskHref(task)} class="items-baseline gap-2 px-1.5 py-1 text-[13px]">
          <span class="shrink-0 font-mono text-xs font-medium tracking-tight text-base-content/75">{task.key}</span>
          <span class="min-w-0 truncate text-base-content/80" title={task.title}>{task.title}</span>
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

<main class="flex flex-col gap-8 sm:gap-9">
  <!-- Phones: headline, then its action, then the cards it is about — never the action after the whole list. -->
  <header class="grid gap-x-8 gap-y-5 max-sm:contents md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3 max-sm:justify-between">
        <BuildViews projectId={page.params.projectId ?? ""} />
        <!-- Live updates: connecting → live, or paused with a way back. -->
        <span
          class="badge badge-sm h-[22px] gap-1.5 rounded-field px-2.5 text-xs font-semibold {connection === 'live'
            ? 'border-mint/40 bg-mint-soft text-mint'
            : connection === 'paused'
              ? 'border-warn/40 bg-warn-soft text-warn'
              : 'border-line bg-base-200 text-base-content/80'}"
          role="status"
          aria-live="polite"
        >
          {#if connection === "paused"}
            <WifiOff class="size-3" aria-hidden="true" />Updates paused
          {:else if connection === "live"}
            <Radio class="size-3" aria-hidden="true" />Live
          {:else}
            <Radio class="size-3" aria-hidden="true" />Connecting…
          {/if}
        </span>
        {#if connection === "paused"}
          <button type="button" class="btn btn-outline btn-sm border-line-control" onclick={() => (reconnects += 1)}>
            <RefreshCw class="size-3.5" aria-hidden="true" />
            Reconnect
          </button>
        {/if}
      </div>
      <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
        {#if data.tasks.length === 0}
          The board fills once tasks are approved.
        {:else if idle && allDone.length > 0}
          {allDone.length === 1 ? "The only task is" : `All ${allDone.length} tasks are`} <span class="text-primary-ink">done</span>.
        {:else if idle}
          Nothing is in progress.
        {:else if reviewTasks.length > 0}
          {reviewTasks.length} work {plural(reviewTasks.length, "order needs", "orders need")} your review.
        {:else if attentionAll.length > 0}
          {attentionAll.length} work {plural(attentionAll.length, "order needs", "orders need")} attention.
        {:else if notStarted}
          {inFlight.length} work {plural(inFlight.length, "order is", "orders are")} ready for an agent.
        {:else}
          {inFlight.length} work {plural(inFlight.length, "order", "orders")} in flight.
        {/if}
      </h1>
    </div>

    <div class="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
      {#if data.tasks.length === 0 || (idle && allDone.length === 0)}
        <a class="btn btn-primary btn-lg" href={`/projects/${data.projectId}/tasks`}>
          Go to tasks<ArrowRight class="size-4" aria-hidden="true" />
        </a>
      {:else if idle}
        <a class="btn btn-ghost" href={`/projects/${data.projectId}/tasks`}>View tasks</a>
        <a class="btn btn-primary btn-lg" href={`/projects/${data.projectId}/convergence`}>
          Open release check<ArrowRight class="size-4" aria-hidden="true" />
        </a>
      {:else if target}
        <a class="btn btn-primary btn-lg" href={taskHref(target)}>
          {target.workflowStatus === "NEEDS_REVIEW" ? "Review" : "Open"} {target.key}<ArrowRight class="size-4" aria-hidden="true" />
        </a>
      {/if}
    </div>
  </header>

  {#if idle && allDone.length > 0}
    <details class="group">
      <summary class="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
        Show done
        <span class="font-normal tabular-nums text-base-content/75">{allDone.length}</span>
      </summary>
      <div class="mt-2 max-w-[640px]">
        {@render doneList(newestFirst(allDone))}
      </div>
    </details>
  {:else if !idle && data.tasks.length > 0}
    {#if reviewTasks.length > 0 && !filterActive}
      <!-- Phones: what the headline asks for comes first (while filtering, it stays in its group). The desktop columns keep the flow order. -->
      <section class="flex flex-col gap-2.5 sm:hidden" aria-labelledby="board-review-phone">
        <h2 id="board-review-phone" class="text-[16px] font-semibold text-base-content">Needs your review</h2>
        <ul class="flex flex-col overflow-hidden rounded-box border border-line bg-base-100">
          {#each reviewTasks as task (task.id)}
            <li class="grid">{@render taskCard(task, false, true)}</li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if attention.length > 0}
      <section class="flex flex-col gap-3.5" aria-labelledby="board-attention">
        <h2 id="board-attention" class="flex items-center gap-2 text-[16px] font-semibold text-base-content">
          <TriangleAlert class="size-4 text-warn" aria-hidden="true" />
          Needs attention
        </h2>
        <ul class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {#each attention as task (task.id)}
            <li class="grid">{@render taskCard(task, true)}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="flex flex-col gap-3.5" aria-labelledby="board-flight">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <!-- Phones: the status groups below carry their own headings. -->
        <h2 id="board-flight" class="text-[16px] font-semibold text-base-content max-sm:sr-only">{notStarted ? "Ready" : "In flight"}</h2>
        <div class="flex w-full items-center gap-2 sm:w-auto sm:flex-wrap">
          <label class="input input-sm min-w-0 grow max-sm:h-11 sm:w-[240px] sm:grow-0">
            <Search class="size-4 shrink-0 text-base-content/75" aria-hidden="true" />
            <input bind:value={filterQuery} type="search" aria-label="Filter cards" placeholder="Filter cards" class="grow" />
            {#if filterQuery}
              <button
                type="button"
                onclick={() => (filterQuery = "")}
                aria-label="Clear filter"
                class="btn btn-ghost btn-xs btn-square -me-1 text-base-content/80"
              >
                <X class="size-3" aria-hidden="true" />
              </button>
            {/if}
          </label>
          {#if availableTypes.length > 1}
            <select bind:value={typeFilter} aria-label="Filter board by task type" class="select select-sm w-auto max-sm:h-11">
              {#each ["ALL", ...availableTypes] as t (t)}
                <option value={t}>{t === "ALL" ? "All types" : t}</option>
              {/each}
            </select>
          {/if}
        </div>
      </div>

      {#if filterActive && filteredTasks.length === 0}
        <p class="flex flex-wrap items-center gap-2 text-[13px] text-base-content/80" role="status">
          No cards match.
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => {
              filterQuery = "";
              typeFilter = "ALL";
            }}
          >
            Clear filter
          </button>
        </p>
      {/if}

      {#if notStarted}
        <ul class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Ready work orders">
          {#each byStatus.get("READY") ?? [] as task (task.id)}
            <li class="grid">{@render taskCard(task, false)}</li>
          {/each}
        </ul>
      {:else}
        <!-- From sm: one row that scrolls sideways. A column with cards keeps a
             readable width (min 15rem) instead of squeezing the cards; an empty
             column shrinks to a narrow rail. Phones get one card: a list grouped
             by status with counts (empty groups left out), Done folded at the end. -->
        <div
          class="grid grid-cols-1 gap-0 max-sm:overflow-hidden max-sm:rounded-box max-sm:border max-sm:border-line max-sm:bg-base-100 sm:flex sm:items-start sm:gap-3.5 sm:overflow-x-auto sm:overscroll-x-contain sm:pb-3"
        >
          {#each ACTIVE_COLUMNS as column (column)}
            {@const columnTasks = byStatus.get(column) ?? []}
            <section
              aria-labelledby={`board-col-${column}`}
              class="flex min-w-0 flex-col gap-2.5 max-sm:gap-0 {columnTasks.length === 0 || (column === 'NEEDS_REVIEW' && reviewTasks.length > 0 && !filterActive)
                ? 'max-sm:hidden'
                : ''} {columnTasks.length === 0 ? 'sm:w-40 sm:shrink-0' : 'sm:min-w-60 sm:flex-1 sm:basis-0'}"
            >
              {@render columnHeading(column, columnTasks.length, `board-col-${column}`, "max-sm:border-b max-sm:border-line")}
              {#if columnTasks.length === 0}
                <p class="rounded-box border border-dashed border-line px-3.5 py-3 text-[13px] text-base-content/75">No tasks</p>
              {:else}
                <ul class="flex flex-col gap-2.5 max-sm:gap-0">
                  {#each columnTasks as task (task.id)}
                    <li class="grid">{@render taskCard(task, false, true)}</li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/each}

          <section aria-labelledby="board-col-DONE" class="flex min-w-0 flex-col gap-2.5 max-sm:gap-0 {doneTasks.length === 0 ? 'sm:w-40 sm:shrink-0' : 'sm:min-w-52 sm:flex-1 sm:basis-0'}">
            {#if doneTasks.length === 0}
              {@render columnHeading("DONE", doneTasks.length, "board-col-DONE")}
              <p class="rounded-box border border-dashed border-line px-3.5 py-3 text-[13px] text-base-content/75 max-sm:hidden">No tasks</p>
            {:else}
              {@render columnHeading("DONE", doneTasks.length, "board-col-DONE", "max-sm:hidden")}
              <details class="group">
                <summary
                  class="btn btn-ghost btn-sm list-none max-sm:h-12 max-sm:w-full max-sm:justify-start max-sm:gap-2 max-sm:rounded-none max-sm:bg-base-200 max-sm:px-3.5 max-sm:text-[13px] [&::-webkit-details-marker]:hidden"
                >
                  <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
                  <span class="group-open:hidden max-sm:hidden">Show done</span>
                  <span class="hidden group-open:inline max-sm:hidden!">Hide done</span>
                  <span class="sm:hidden">Done</span>
                  <span class="font-medium tabular-nums text-base-content/75 sm:hidden">{doneTasks.length}<span class="sr-only">{doneTasks.length === 1 ? " task" : " tasks"}</span></span>
                </summary>
                <div class="max-sm:border-t max-sm:border-line max-sm:px-2 max-sm:py-1">
                  {@render doneList(doneTasks)}
                </div>
              </details>
            {/if}
          </section>
        </div>
      {/if}
    </section>
  {/if}
</main>
