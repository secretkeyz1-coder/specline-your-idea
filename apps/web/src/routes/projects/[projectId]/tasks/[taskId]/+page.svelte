<script lang="ts">
  import { ArrowLeft, ChevronDown, Gauge } from "lucide-svelte";
  import { untrack } from "svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import TaskDecisionPanel from "$lib/components/task/TaskDecisionPanel.svelte";
  import WorkOrderTab from "$lib/components/task/WorkOrderTab.svelte";
  import RunsTab from "$lib/components/task/RunsTab.svelte";
  import TraceTab from "$lib/components/task/TraceTab.svelte";
  import { actorLabel, hardnessTitle, hardnessWord, reviewPolicyLabel } from "$lib/labels.js";
  import type { ReviewRow, RunRow, ScreenReview, TaskDetail, TaskEventRow, TaskLinkRow, TraceLink } from "$lib/task-detail.js";

  let {
    data,
    form,
  }: {
    data: {
      projectId: string;
      task: TaskDetail;
      dependencies: TaskLinkRow[];
      dependents: TaskLinkRow[];
      traceability: TraceLink[];
      screen_review: ScreenReview | null;
      runs: RunRow[];
      events: TaskEventRow[];
      reviews: ReviewRow[];
    };
    form: { prompt?: string; mode?: string; notice?: string; message?: string } | null;
  } = $props();

  let busy = $state<string | null>(null);

  // States where a person decides (review, rework, unblock, done) show the
  // decision rail; every other state hands the work order to an agent there.
  const DECISION_STATES = ["NEEDS_REVIEW", "CHANGES_REQUESTED", "BLOCKED", "DONE"];
  const decides = $derived(DECISION_STATES.includes(data.task.workflowStatus));
  // Reviewing reads in order: what was asked → what it proved → what changed →
  // the decision. The scope and the changed files are then open, not folded.
  const reviewing = $derived(data.task.workflowStatus === "NEEDS_REVIEW");

  // Review needs evidence first: once a run exists, open on Runs & evidence.
  // Only the initial tab is derived from the task; afterwards it is the user's.
  const initialTab = (): "prompt" | "runs" =>
    DECISION_STATES.includes(data.task.workflowStatus) || data.runs.length > 0 ? "runs" : "prompt";
  let activeRightTab = $state<"prompt" | "runs" | "trace">(untrack(initialTab));
  // Going from one task to another (a dependency link) reuses this component:
  // nothing typed or shown for the previous task may carry over. The markup —
  // the panels and tabs with their own state — is keyed on the task id below;
  // the page's own state is reset here.
  let shownTaskId = untrack(() => data.task.id);
  $effect.pre(() => {
    const id = data.task.id;
    if (id === shownTaskId) return;
    shownTaskId = id;
    untrack(() => {
      busy = null;
      activeRightTab = initialTab();
    });
  });

  // The prompts live in the side rail while the task waits for an agent; the
  // tab carries them once a decision takes that place.
  const TABS = $derived([
    ...(decides ? [{ id: "prompt" as const, label: "Work order" }] : []),
    { id: "runs" as const, label: `Runs (${data.runs.length})` },
    { id: "trace" as const, label: "Traceability" },
  ]);
  const shownTab = $derived(TABS.some((t) => t.id === activeRightTab) ? activeRightTab : TABS[0]!.id);

  function onTabKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === shownTab);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    activeRightTab = TABS[next]!.id;
    document.getElementById(`tab-${TABS[next]!.id}`)?.focus();
  }

  // The attempt a reviewer decides on: the submitted one, else the latest.
  const latestRun = $derived(data.runs.find((r) => r.run.status === "SUBMITTED") ?? data.runs[0] ?? null);

  // Every required command with the latest attempt's result, then any extra
  // results the agent reported.
  type CheckRow = { command: string; status: string | null };
  const checks = $derived.by<CheckRow[]>(() => {
    const tests = latestRun?.tests ?? [];
    const rows: CheckRow[] = data.task.contract.verification.required.map((v) => ({
      command: v.command,
      status: tests.find((t) => t.command === v.command)?.status ?? null,
    }));
    for (const t of tests) if (!rows.some((r) => r.command === t.command)) rows.push({ command: t.command, status: t.status });
    return rows;
  });
  const passed = $derived(checks.filter((c) => c.status === "PASSED").length);
  const failed = $derived(checks.filter((c) => c.status === "FAILED" || c.status === "ERROR").length);
  const allPassed = $derived(latestRun !== null && checks.length > 0 && passed === checks.length);

  function checkTone(status: string | null): { word: string; cls: string; dot: string; line: string } {
    if (status === "PASSED") return { word: "passed", cls: "text-mint", dot: "bg-mint", line: "bg-mint/40" };
    if (status === "FAILED" || status === "ERROR") return { word: "failed", cls: "text-danger", dot: "bg-danger", line: "bg-danger/40" };
    if (status === "SKIPPED") return { word: "not run", cls: "text-base-content/75", dot: "bg-line-control", line: "bg-line" };
    return { word: status ? status.toLowerCase() : "not run yet", cls: "text-base-content/75", dot: "bg-line-control", line: "bg-line" };
  }
</script>

{#snippet scopeLists()}
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="min-w-0">
      <h3 class="text-[13px] font-semibold">May change</h3>
      <ul class="mt-1.5 flex flex-col gap-1">
        {#each data.task.contract.scope.expected_paths as path}
          <li class="font-mono text-xs break-all text-base-content/80">{path}</li>
        {:else}
          <li class="text-xs text-base-content/75">None declared</li>
        {/each}
      </ul>
    </div>
    <div class="min-w-0">
      <h3 class="text-[13px] font-semibold">Must not touch</h3>
      <ul class="mt-1.5 flex flex-col gap-1">
        {#each data.task.contract.scope.forbidden_paths as path}
          <li class="font-mono text-xs break-all text-base-content/80">{path}</li>
        {:else}
          <li class="text-xs text-base-content/75">None declared</li>
        {/each}
      </ul>
    </div>
  </div>
{/snippet}

{#key data.task.id}
<main class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
  <div class="flex min-w-0 flex-col gap-6 sm:gap-7">
    {#if form?.notice}
      <Notice tone="success">{form.notice}</Notice>
    {:else if form?.message}
      <Notice tone="error">{form.message}</Notice>
    {/if}

    <header class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <a
          href={`/projects/${data.projectId}/tasks`}
          class="btn btn-ghost btn-sm -ms-3 gap-1.5 font-medium text-base-content/80 hover:text-base-content"
        >
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Tasks
        </a>
        <StatusBadge status={data.task.workflowStatus} />
        <span class="font-mono text-xs font-medium tracking-tight text-base-content/75">{data.task.key}</span>
        <span class="flex items-center gap-1.5 text-xs text-base-content/75" title={hardnessTitle(data.task.hardness)}>
          <Gauge class="size-3 shrink-0" aria-hidden="true" /><span class="sr-only">Hardness:</span>{hardnessWord(data.task.hardness)}
        </span>
      </div>
      <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
        {data.task.title}{#if allPassed && (data.task.workflowStatus === "NEEDS_REVIEW" || data.task.workflowStatus === "DONE")}{" "}<span class="text-primary-ink">passed</span> its checks.{/if}
      </h1>
      {#if data.task.objective}
        <p class="max-w-[72ch] text-[13px] leading-relaxed text-base-content/80">{data.task.objective}</p>
      {/if}
      {#if reviewing}
        <!-- Below lg the decision sits after the evidence; a way straight there. -->
        <a href="#decision" class="btn btn-outline btn-sm self-start border-line-control lg:hidden">
          <ChevronDown class="size-3.5" aria-hidden="true" />Jump to your decision
        </a>
      {/if}
    </header>

    <section class="card flex flex-col gap-3 border border-line bg-base-100 px-5 py-5 max-sm:px-4 sm:px-6" aria-labelledby="ac-title">
      <!-- What was asked. -->
      <h2 id="ac-title" class="text-[14px] font-semibold">Acceptance criteria</h2>
      {#if data.task.contract.acceptance_criteria.length === 0}
        <p class="text-[13px] text-base-content/75">None listed.</p>
      {:else}
        <ul class="flex flex-col gap-2.5 text-[13px] leading-relaxed">
          {#each data.task.contract.acceptance_criteria as ac}
            <li class="flex gap-2.5">
              <span class="mt-[7px] size-2 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
              <span>{ac}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- What it proved: the checks the work order requires, with the latest results. -->
    <section class="card flex flex-col gap-3.5 border border-line bg-base-100 px-5 py-5 max-sm:px-4 sm:px-6" aria-labelledby="checks-title">
      <div class="flex flex-wrap items-center gap-2.5 max-sm:justify-between">
        <h2 id="checks-title" class="text-[14px] font-semibold">Checks</h2>
        {#if latestRun && checks.length > 0}
          <span
            class="badge badge-sm h-[22px] rounded-field px-2.5 text-xs font-semibold {failed > 0
              ? 'border-danger/40 bg-danger-soft text-danger'
              : allPassed
                ? 'border-mint/40 bg-mint-soft text-mint'
                : 'border-line bg-base-200 text-base-content/80'}"
          >
            {passed} of {checks.length} passed
          </span>
        {/if}
      </div>
      {#if checks.length === 0}
        <p class="text-[13px] text-base-content/75">No checks listed.</p>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each checks as check (check.command)}
            {@const tone = checkTone(check.status)}
            <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)_96px]">
              <span class="truncate font-mono text-xs" title={check.command}>$ {check.command}</span>
              <span class="hidden h-0.5 rounded-full sm:block {tone.line}" aria-hidden="true"></span>
              <span class="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap {tone.cls}">
                <span class="size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>{tone.word}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if latestRun}
        <div class="flex flex-col gap-2 border-t border-line pt-3 text-[13px]">
          <p class="text-xs text-base-content/75">
            Attempt {latestRun.run.attempt} · {actorLabel(latestRun.run.executorType)}{latestRun.run.commitSha ? ` · commit ${latestRun.run.commitSha.slice(0, 8)}` : ""}
          </p>
          {#if latestRun.run.summary}
            <p class="leading-relaxed text-base-content/80">{latestRun.run.summary}</p>
          {/if}
          {#if latestRun.run.metadata?.ai_review}
            {@const review = latestRun.run.metadata.ai_review}
            <details class="rounded-box border border-base-300 p-3">
              <summary class="cursor-pointer font-semibold">AI review: {review.recommended_decision.replaceAll("_", " ")}</summary>
              <p class="mt-2">{review.summary}</p>
              <ol class="mt-2 list-decimal space-y-1 ps-5">
                {#each review.acceptance_coverage as criterion}
                  <li>Criterion {criterion.criterion_index + 1}: {criterion.status} — {criterion.evidence}</li>
                {/each}
              </ol>
              {#each review.findings as finding}
                <p class="mt-2">{finding.severity}: {finding.message}</p>
              {/each}
            </details>
          {/if}
          {#if reviewing}
            <!-- Listed under "What changed", next to the scope. -->
          {:else if latestRun.run.filesChanged.length}
            <details class="group text-xs">
              <summary class="flex cursor-pointer list-none items-center gap-1.5 font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
                <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
                {latestRun.run.filesChanged.length} {latestRun.run.filesChanged.length === 1 ? "file" : "files"} changed
              </summary>
              <ul class="mt-1.5 max-h-[160px] overflow-y-auto ps-5 font-mono text-base-content/80">
                {#each latestRun.run.filesChanged as file (file)}
                  <li class="truncate" title={file}>{file}</li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>
      {/if}
    </section>


    {#if reviewing}
      <!-- What changed: the files the attempt touched, against what it was allowed to touch. -->
      <section class="card flex flex-col gap-4 border border-line bg-base-100 px-5 py-5 max-sm:px-4 sm:px-6" aria-labelledby="changed-title">
        <h2 id="changed-title" class="text-[14px] font-semibold">What changed</h2>
        <div class="min-w-0">
          <h3 class="text-[13px] font-semibold">
            {#if latestRun?.run.filesChanged.length}
              {latestRun.run.filesChanged.length} {latestRun.run.filesChanged.length === 1 ? "file" : "files"} changed
            {:else}
              Files changed
            {/if}
          </h3>
          {#if latestRun?.run.filesChanged.length}
            <ul class="mt-1.5 flex max-h-[240px] flex-col gap-1 overflow-y-auto font-mono text-xs text-base-content/80">
              {#each latestRun.run.filesChanged as file (file)}
                <li class="break-all">{file}</li>
              {/each}
            </ul>
          {:else}
            <p class="mt-1.5 text-xs text-base-content/75">No changed files listed — check the commit.</p>
          {/if}
        </div>
        <div class="border-t border-line pt-4">{@render scopeLists()}</div>
      </section>
    {/if}

    <!-- The rest of the contract, the runs and the trace: one disclosure. -->
    <details class="group card border border-line bg-base-100">
      <summary class="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-5 text-[13px] font-semibold max-sm:px-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <ChevronDown class="size-4 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
        {reviewing ? "Work order details, runs and traceability" : "Details"}
      </summary>
      <div class="flex flex-col gap-5 border-t border-line px-5 py-5 max-sm:px-4 sm:px-6">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/80">
          <span>{data.task.taskType}</span>
          <span aria-hidden="true">·</span>
          <span class="font-mono">P{data.task.priority.replace(/^P/i, "")}</span>
          <span aria-hidden="true">·</span>
          <span title={hardnessTitle(data.task.hardness)}>Hardness {data.task.hardness}/5, {hardnessWord(data.task.hardness)}</span>
          <span aria-hidden="true">·</span>
          <span>{reviewPolicyLabel(data.task.reviewPolicy)}</span>
          {#if data.task.parallelSafe}
            <span aria-hidden="true">·</span>
            <span>Parallel-safe</span>
          {/if}
        </p>

        {#if !reviewing}{@render scopeLists()}{/if}

        <div class="min-w-0">
          <h3 class="text-[13px] font-semibold">Stop conditions</h3>
          <ul class="mt-1.5 flex flex-col gap-1 text-[13px] leading-relaxed text-base-content/80">
            {#each data.task.contract.stop_conditions as condition}
              <li class="flex gap-2"><span class="mt-2 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true"></span>{condition}</li>
            {:else}
              <li class="text-xs text-base-content/75">None listed</li>
            {/each}
          </ul>
        </div>

        {#if data.task.contract.constraints.length}
          <div class="min-w-0">
            <h3 class="text-[13px] font-semibold">Constraints</h3>
            <ul class="mt-1.5 flex flex-col gap-1 text-[13px] leading-relaxed text-base-content/80">
              {#each data.task.contract.constraints as constraint}
                <li class="flex gap-2"><span class="mt-2 size-1.5 shrink-0 rounded-full bg-line-control" aria-hidden="true"></span>{constraint}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Runs, traceability and (once a decision holds the rail) the prompts. -->
        <div class="overflow-hidden rounded-box border border-line">
          <div class="tabs tabs-border flex-nowrap border-b border-line bg-base-200" role="tablist" aria-label="Work order panels" tabindex="-1" onkeydown={onTabKeydown}>
            {#each TABS as tab (tab.id)}
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={shownTab === tab.id}
                aria-controls="work-order-panel"
                tabindex={shownTab === tab.id ? 0 : -1}
                onclick={() => (activeRightTab = tab.id)}
                class="tab h-11 flex-1 px-1 text-[13px] font-medium {shownTab === tab.id ? 'tab-active text-base-content' : 'text-base-content/80 hover:text-base-content'}"
              >
                {tab.label}
              </button>
            {/each}
          </div>
          <div class="p-4" role="tabpanel" id="work-order-panel" aria-labelledby={`tab-${shownTab}`} tabindex="0">
            {#if shownTab === "prompt"}
              <WorkOrderTab task={data.task} runCount={data.runs.length} primary={false} bind:busy />
            {:else if shownTab === "runs"}
              <RunsTab runs={data.runs} events={data.events} />
            {:else}
              <TraceTab traceability={data.traceability} dependencies={data.dependencies} dependents={data.dependents} />
            {/if}
          </div>
        </div>
      </div>
    </details>
  </div>

  <aside id="decision" class="min-w-0 scroll-mt-20 lg:sticky lg:top-24">
    {#if decides}
      <TaskDecisionPanel task={data.task} runs={data.runs} reviews={data.reviews} screenReview={data.screen_review} bind:busy />
    {:else}
      {@const waiting = data.task.workflowStatus === "READY" || data.task.workflowStatus === "DRAFT"}
      <section
        class="card flex flex-col gap-3.5 border bg-base-100 p-5 max-sm:px-4 sm:p-6 {waiting ? 'border-primary-ink' : 'border-line'}"
        aria-labelledby="handoff-title"
      >
        <h2 id="handoff-title" class="text-[16px] font-semibold">{waiting ? "Hand to an agent" : "With an agent"}</h2>
        <WorkOrderTab task={data.task} runCount={data.runs.length} primary={waiting} bind:busy />
      </section>
    {/if}
  </aside>
</main>
{/key}
