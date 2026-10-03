<script lang="ts">
  import { page } from "$app/state";
  import { enhance } from "$app/forms";
  import {
    Ban,
    Bug as BugIcon,
    ChevronDown,
    CircleCheck,
    CircleDot,
    FileCode2,
    FlaskConical,
    OctagonAlert,
    Plus,
    Send,
    Wrench,
    X,
  } from "lucide-svelte";
  import { BUG_BLOCKING_STATUSES, BUG_TRIAGE_STATUSES, isBlockingBug, isOpenBug } from "$lib/status.js";
  import type { BugRow } from "$lib/types.js";
  import { bugStatusLabel } from "$lib/labels.js";
  import Notice from "$lib/components/Notice.svelte";
  import BuildViews from "$lib/components/BuildViews.svelte";

  let {
    data,
    form,
  }: {
    data: { bugs: BugRow[] };
    form: { ok?: boolean; notice?: string; message?: string } | null;
  } = $props();

  let busy = $state<string | null>(null);
  let expanded = $state<string | null>(null);
  // Phones: the report form opens on request; from lg up it is always beside the list.
  let reportOpen = $state(false);
  let statusFilter = $state<"ALL" | "OPEN" | "TRIAGE" | "FIXING" | "RESOLVED">("OPEN");
  let createError = $state<string | null>(null);
  function openReport() {
    createError = null;
    reportOpen = true;
    queueMicrotask(() => document.getElementById("bug-title")?.focus());
  }

  const FILTERS = [
    { id: "OPEN", label: "Open" },
    { id: "TRIAGE", label: "Needs triage" },
    { id: "FIXING", label: "Being fixed" },
    { id: "RESOLVED", label: "Resolved" },
    { id: "ALL", label: "All" },
  ] as const;

  // Same rule as the completion gate: a confirmed-but-unverified bug blocks
  // its feature, whatever its severity.
  const blockingBugs = $derived(data.bugs.filter((b) => isBlockingBug(b.status)));
  const openBugs = $derived(data.bugs.filter((b) => isOpenBug(b.status)));

  const filteredBugs = $derived.by(() => {
    switch (statusFilter) {
      case "OPEN":
        return data.bugs.filter((b) => isOpenBug(b.status));
      case "TRIAGE":
        return data.bugs.filter((b) => (BUG_TRIAGE_STATUSES as readonly string[]).includes(b.status));
      case "FIXING":
        return data.bugs.filter((b) => (BUG_BLOCKING_STATUSES as readonly string[]).includes(b.status));
      case "RESOLVED":
        return data.bugs.filter((b) => !isOpenBug(b.status));
      default:
        return data.bugs;
    }
  });
  const filterLabel = $derived(FILTERS.find((f) => f.id === statusFilter)?.label ?? "All");

  /** A bug's one status badge: icon + word, the tone supplemental. */
  function bugTone(status: string): { icon: typeof BugIcon; cls: string } {
    switch (status) {
      case "REPORTED":
      case "ASSESSING":
        return { icon: CircleDot, cls: "border-warn/40 bg-warn-soft text-warn" };
      case "CONFIRMED":
        return { icon: OctagonAlert, cls: "border-danger/40 bg-danger-soft text-danger" };
      case "PLANNED":
      case "IN_FIX":
        return { icon: Wrench, cls: "border-sky/40 bg-sky-soft text-sky" };
      case "VERIFYING":
        return { icon: FlaskConical, cls: "border-violet/40 bg-violet-soft text-violet" };
      case "VERIFIED":
      case "CLOSED":
        return { icon: CircleCheck, cls: "border-mint/40 bg-mint-soft text-mint" };
      default:
        return { icon: Ban, cls: "border-line bg-base-200 text-base-content/75" };
    }
  }
</script>

<main class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_420px]">
  <div class="flex min-w-0 flex-col gap-6 sm:gap-7">
    <header class="flex flex-col gap-4">
      <BuildViews projectId={page.params.projectId ?? ""} bugCount={openBugs.length} />
      <div class="flex flex-wrap items-end justify-between gap-4">
        <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
          {#if blockingBugs.length > 0}
            {blockingBugs.length} {blockingBugs.length === 1 ? "bug keeps" : "bugs keep"} features from completing.
          {:else if openBugs.length > 0}
            {openBugs.length} open {openBugs.length === 1 ? "bug" : "bugs"}, none blocking.
          {:else if data.bugs.length > 0}
            No open <span class="text-primary-ink">bugs</span>.
          {:else}
            No bugs <span class="text-primary-ink">reported</span>.
          {/if}
        </h1>
        {#if !reportOpen}
          <button type="button" onclick={openReport} class="btn btn-primary max-sm:hidden lg:hidden">
            <Plus class="size-4" aria-hidden="true" />
            Report bug
          </button>
        {/if}
      </div>
    </header>

    {#if form?.notice}
      <Notice tone="success">{form.notice}</Notice>
    {:else if form?.message}
      <Notice tone="error">{form.message}</Notice>
    {/if}

    {#if data.bugs.length > 0}
      <!-- Five filters: a select-style button on phones. -->
      <label class="select h-11 w-auto self-start sm:hidden">
        <span class="sr-only">Filter bugs</span>
        <select bind:value={statusFilter}>
          {#each FILTERS as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </label>
      <div class="join max-w-full self-start overflow-x-auto max-sm:hidden" role="group" aria-label="Filter bugs">
        {#each FILTERS as f (f.id)}
          <button
            type="button"
            onclick={() => (statusFilter = f.id)}
            aria-pressed={statusFilter === f.id}
            class="btn btn-sm join-item border-line whitespace-nowrap {statusFilter === f.id ? 'btn-active' : 'bg-base-200 font-medium text-base-content/80'}"
          >
            {f.label}
          </button>
        {/each}
      </div>
      <span class="sr-only" aria-live="polite">{filteredBugs.length} showing</span>
    {/if}

    {#if data.bugs.length === 0}
      <p class="text-[13px] text-base-content/80">Report wrong behaviour here. A confirmed bug becomes a fix task in one click.</p>
    {:else if filteredBugs.length === 0}
      <div class="card flex flex-col items-center gap-3 border border-line bg-base-100 p-10 text-center text-[13px] text-base-content/80">
        <p>No bugs in <span class="font-medium text-base-content">{filterLabel}</span>.</p>
        <button type="button" class="btn btn-sm btn-outline border-line-control" onclick={() => (statusFilter = "ALL")}>Show all bugs</button>
      </div>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each filteredBugs as bug (bug.id)}
          {@const tone = bugTone(bug.status)}
          {@const hasAction = bug.status === "REPORTED" || bug.status === "ASSESSING" || ((bug.status === "CONFIRMED" || bug.status === "PLANNED") && !bug.fixTaskId)}
          <li>
            <article class="card border border-line bg-base-100 px-4 py-4 max-sm:relative max-sm:py-3.5 sm:px-5">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 max-sm:pe-10">
                    <span class="font-mono text-xs font-semibold tracking-tight">{bug.key}</span>
                    <span class="badge badge-sm h-[22px] gap-1.5 rounded-field px-2.5 text-xs font-semibold whitespace-nowrap {tone.cls}">
                      <tone.icon class="size-3 shrink-0" aria-hidden="true" />{bugStatusLabel(bug.status)}
                    </span>
                    <span class="text-xs text-base-content/75"><span class="sr-only">Severity: </span>{bug.severity.toLowerCase()}</span>
                    {#if bug.fixTaskId}
                      <a
                        class="flex items-center gap-1 text-xs font-medium whitespace-nowrap text-base-content/80 hover:text-base-content hover:underline"
                        href={`/projects/${page.params.projectId}/tasks/${bug.fixTaskId}`}
                      >
                        <FileCode2 class="size-3" aria-hidden="true" />Fix task
                      </a>
                    {/if}
                    <!-- Phones: the details toggle ends the top row (the desktop one ends the action row). -->
                    <button
                      class="btn btn-ghost btn-square absolute end-2 top-2 size-11 text-base-content/80 hover:text-base-content sm:hidden"
                      type="button"
                      onclick={() => (expanded = expanded === bug.id ? null : bug.id)}
                      aria-expanded={expanded === bug.id}
                      aria-label={`${expanded === bug.id ? "Hide" : "Show"} details of ${bug.key}`}
                    >
                      <ChevronDown class="size-4 transition-transform {expanded === bug.id ? 'rotate-180' : ''}" aria-hidden="true" />
                    </button>
                  </div>
                  <h2 class="text-[14px] leading-snug font-semibold tracking-tight text-base-content">{bug.title}</h2>
                </div>

                <div class="flex shrink-0 items-center justify-between gap-1 sm:justify-end {hasAction ? '' : 'max-sm:hidden'}">
                  {#if bug.status === "REPORTED" || bug.status === "ASSESSING"}
                    <form
                      method="post"
                      action="?/confirm"
                      use:enhance={() => {
                        busy = bug.id;
                        return async ({ update }) => {
                          busy = null;
                          await update();
                        };
                      }}
                    >
                      <input type="hidden" name="bugId" value={bug.id} />
                      <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={busy !== null} aria-busy={busy === bug.id}>
                        {#if busy === bug.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                        <span>{busy === bug.id ? "Confirming…" : "Confirm bug"}</span>
                        <span class="sr-only">{bug.key}</span>
                      </button>
                    </form>
                  {:else if (bug.status === "CONFIRMED" || bug.status === "PLANNED") && !bug.fixTaskId}
                    <form
                      method="post"
                      action="?/generateFixTask"
                      use:enhance={() => {
                        busy = bug.id;
                        return async ({ update }) => {
                          busy = null;
                          await update();
                        };
                      }}
                    >
                      <input type="hidden" name="bugId" value={bug.id} />
                      <!-- Not an AI call: the API builds the fix task from the bug and
                           its linked task in a moment, so an in-button spinner is enough. -->
                      <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={busy !== null} aria-busy={busy === bug.id}>
                        {#if busy === bug.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                        <span>{busy === bug.id ? "Creating…" : "Create fix task"}</span>
                        <span class="sr-only">for {bug.key}</span>
                      </button>
                    </form>
                  {/if}
                  <button
                    class="btn btn-sm btn-ghost btn-square ms-auto text-base-content/80 hover:text-base-content max-sm:hidden"
                    type="button"
                    onclick={() => (expanded = expanded === bug.id ? null : bug.id)}
                    aria-expanded={expanded === bug.id}
                    aria-label={`${expanded === bug.id ? "Hide" : "Show"} details of ${bug.key}`}
                  >
                    <ChevronDown class="size-4 transition-transform {expanded === bug.id ? 'rotate-180' : ''}" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {#if expanded === bug.id}
                <dl class="mt-4 grid gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt class="text-xs font-semibold text-danger">What happens</dt>
                    <dd class="mt-0.5 leading-relaxed">{bug.currentBehavior}</dd>
                  </div>
                  <div>
                    <dt class="text-xs font-semibold text-mint">Expected</dt>
                    <dd class="mt-0.5 leading-relaxed">{bug.expectedBehavior}</dd>
                  </div>
                  {#if bug.unchangedBehavior}
                    <div class="sm:col-span-2">
                      <dt class="text-xs font-semibold text-base-content/80">Must keep working</dt>
                      <dd class="mt-0.5 leading-relaxed text-base-content/80">{bug.unchangedBehavior}</dd>
                    </div>
                  {/if}
                  <div class="sm:col-span-2">
                    <dt class="text-xs font-semibold text-base-content/80">Steps to reproduce</dt>
                    <dd class="mt-1 rounded-box border border-line bg-base-200 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-base-content/80">{bug.reproduction}</dd>
                  </div>
                </dl>
              {/if}
            </article>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Phones: the one primary action ends the list, in thumb reach; the form opens below it. -->
    {#if !reportOpen}
      <button type="button" onclick={openReport} class="btn btn-primary btn-lg w-full sm:hidden">
        <Plus class="size-4" aria-hidden="true" />
        Report bug
      </button>
    {/if}
  </div>

  <!-- Report a bug: beside the list from lg up; on tablets it opens above the list, on phones after it. -->
  <section
    class="card order-first flex-col gap-5 border border-line bg-base-100 p-5 max-sm:order-none max-sm:p-4 sm:p-7 lg:order-none lg:sticky lg:top-24 lg:flex {reportOpen ? 'flex' : 'hidden'}"
    aria-labelledby="report-bug-title"
  >
    <div class="flex items-center justify-between gap-3">
      <h2 id="report-bug-title" class="text-[18px] font-bold tracking-tight">Report a bug</h2>
      <button
        type="button"
        onclick={() => (reportOpen = false)}
        class="btn btn-sm btn-ghost btn-square text-base-content/80 lg:hidden"
        aria-label="Close"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <form
      method="post"
      action="?/create"
      use:enhance={() => {
        busy = "create";
        createError = null;
        return async ({ result, update }) => {
          busy = null;
          // Only clear on success; a failed save keeps everything typed.
          if (result.type === "success") {
            reportOpen = false;
            await update();
          } else if (result.type === "failure") {
            createError = (result.data as { message?: string } | undefined)?.message ?? "The bug could not be saved. Try again.";
          } else {
            await update({ reset: false });
          }
        };
      }}
      class="flex flex-col gap-4"
    >
      <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-2.5">
        <div class="flex flex-col gap-1.5">
          <label for="bug-title" class="text-[13px] font-semibold">Title</label>
          <input id="bug-title" class="input w-full" type="text" name="title" required placeholder="e.g. Sync drops the second photo" maxlength="200" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="bug-severity" class="text-[13px] font-semibold">Severity</label>
          <select id="bug-severity" class="select w-full" name="severity">
            <option value="BLOCKER">Blocker</option>
            <option value="CRITICAL">Critical</option>
            <option value="MAJOR" selected>Major</option>
            <option value="MINOR">Minor</option>
            <option value="TRIVIAL">Trivial</option>
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="bug-reproduction" class="text-[13px] font-semibold">Steps to reproduce</label>
        <textarea
          id="bug-reproduction"
          class="textarea min-h-[76px] w-full font-mono text-[13px]"
          name="reproduction"
          required
          aria-describedby="bug-reproduction-hint"
          placeholder={"1. Take two photos offline\n2. Reconnect and open the work order"}
        ></textarea>
        <span id="bug-reproduction-hint" class="text-xs text-base-content/80">Numbered steps someone else can follow.</span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="bug-expected" class="text-[13px] font-semibold">Expected</label>
        <textarea id="bug-expected" class="textarea min-h-[56px] w-full text-[13px]" name="expected" required placeholder="Both photos appear on the work order."></textarea>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="bug-current" class="text-[13px] font-semibold">What happens</label>
        <textarea id="bug-current" class="textarea min-h-[56px] w-full text-[13px]" name="current" required placeholder="Only the first photo appears."></textarea>
      </div>

      <details class="group">
        <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
          <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
          Must keep working
        </summary>
        <textarea
          id="bug-unchanged"
          class="textarea mt-1.5 min-h-[48px] w-full text-[13px]"
          name="unchanged"
          aria-label="What must keep working (optional)"
          placeholder="Optional: behaviour the fix must not break"
        ></textarea>
      </details>

      {#if createError}
        <Notice tone="error">{createError}</Notice>
      {/if}

      <div class="flex justify-end">
        <button class="btn btn-primary max-sm:btn-lg max-sm:w-full" type="submit" disabled={busy !== null}>
          {#if busy === "create"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          <span>{busy === "create" ? "Reporting…" : "Report bug"}</span>
          {#if busy !== "create"}<Send class="size-4" aria-hidden="true" />{/if}
        </button>
      </div>
    </form>
  </section>
</main>
