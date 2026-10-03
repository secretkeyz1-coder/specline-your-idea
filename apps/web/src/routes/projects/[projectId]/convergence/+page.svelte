<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { Check, ChevronDown, ChevronRight, CircleCheck, CircleDashed, Hammer, Lock, Radar, TriangleAlert } from "lucide-svelte";
  import { findingLabel } from "$lib/labels.js";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import Notice from "$lib/components/Notice.svelte";

  type Finding = {
    id: string;
    findingType: string;
    severity: string;
    description: string;
    requirementKey: string | null;
    resolutionStatus: string;
    generatedTaskId?: string | null;
  };

  let {
    data,
    form,
  }: {
    data: {
      features: Array<{ id: string; key: string; title: string; status: string }>;
      perFeature: Array<{
        feature: { id: string; key: string; title: string; status: string };
        runs: Array<{
          run: {
            id: string;
            status: string;
            summary: string;
            completionRecommended: string;
            createdAt: string;
          };
          findings: Finding[];
        }>;
        gate: {
          canComplete: boolean;
          blockers: {
            open_blocking_findings: Array<{ id: string; description: string }>;
            blocking_bugs: Array<{ id: string; key: string; title: string }>;
            incomplete_tasks: Array<{ id: string; key: string; status: string }>;
            convergence_recommended: boolean;
            no_tasks?: boolean;
          };
        };
      }>;
    };
    form: { ok?: boolean; notice?: string; message?: string } | null;
  } = $props();

  const projectId = $derived(page.params.projectId ?? "");

  let busy = $state<string | null>(null);
  // Only the release check is a long AI call; marking complete is instant.
  let runningCheck = $state(false);
  // The feature completed in this visit — its summary settles in once; on a
  // later load the same summary is simply there, without motion.
  let justCompleted = $state<string | null>(null);
  // The feature waiting for "Mark complete" to be confirmed.
  let confirming = $state<{ id: string; key: string; title: string } | null>(null);

  // Fixed locale + zone: server and browser must render the same string.
  const auditTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const checkedAt = (iso: string) => `${auditTime.format(new Date(iso))} UTC`;

  type Entry = (typeof data)["perFeature"][number];
  const open = (e: Entry) => e.feature.status !== "COMPLETE";
  // Work first: gaps, then ready to mark, then unchecked. Finished features
  // fold into one row — except one completed during this visit, which stays
  // in view so its "complete and verified" moment is seen.
  const gapEntries = $derived(data.perFeature.filter((e) => open(e) && e.runs.length > 0 && !e.gate.canComplete));
  const readyEntries = $derived(data.perFeature.filter((e) => open(e) && e.gate.canComplete));
  const uncheckedEntries = $derived(data.perFeature.filter((e) => open(e) && e.runs.length === 0 && !e.gate.canComplete));
  const settledEntry = $derived(data.perFeature.find((e) => !open(e) && e.feature.id === justCompleted) ?? null);
  const doneEntries = $derived(data.perFeature.filter((e) => !open(e) && e.feature.id !== justCompleted));

  const totalFeatures = $derived(data.perFeature.length);
  const completedFeatures = $derived(data.perFeature.filter((e) => !open(e)).length);
  const stillToBuild = $derived(
    new Set(data.perFeature.flatMap((e) => (open(e) ? e.gate.blockers.incomplete_tasks.map((t) => t.id) : []))).size,
  );

  // The page's one primary action: mark the first ready feature complete, or
  // run the first check whose work is all built.
  const primaryId = $derived(
    readyEntries[0]?.feature.id ??
      uncheckedEntries.find((e) => !e.gate.blockers.no_tasks && e.gate.blockers.incomplete_tasks.length === 0)?.feature.id ??
      null,
  );

  const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const actionable = (e: Entry) =>
    (e.runs[0]?.findings ?? []).filter((f) => f.findingType !== "COVERED" && f.findingType !== "NOT_APPLICABLE");
</script>

<!-- One inset row per thing that stands between a feature and "complete". -->
{#snippet gapRow(tone: "danger" | "warn" | "quiet", title: string, key: string | null, detail: string)}
  <span class="flex min-w-0 flex-col gap-1">
    <span class="text-[13px] font-semibold">
      {#if tone === "danger"}<span class="sr-only">Blocking: </span>{:else if tone === "warn"}<span class="sr-only">To fix: </span>{/if}{title}
      {#if key}<span class="ms-1 font-mono text-xs font-medium text-base-content/80">{key}</span>{/if}
    </span>
    {#if detail.length > 140}
      <!-- Long evidence folds to two lines so the next gap (and its fix) stays in view. -->
      <details class="group/detail">
        <summary class="cursor-pointer list-none text-[13px] leading-relaxed text-base-content/80 [&::-webkit-details-marker]:hidden">
          <span class="line-clamp-2 group-open/detail:line-clamp-none">{detail}</span>
          <span class="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-base-content underline-offset-2 hover:underline">
            <ChevronDown class="size-3 transition-transform group-open/detail:rotate-180" aria-hidden="true" /><span class="group-open/detail:hidden">Show all</span><span class="hidden group-open/detail:inline">Show less</span>
          </span>
        </summary>
      </details>
    {:else if detail}
      <span class="text-[13px] leading-relaxed text-base-content/80">{detail}</span>
    {/if}
  </span>
{/snippet}

{#snippet findingRows(entry: Entry)}
  {#each actionable(entry) as finding (finding.id)}
    {@const blocking = finding.severity === "BLOCKING"}
    <!-- The gap and what fixes it on one line, on phones too: the action never sits below the evidence. -->
    <li
      class="flex items-start justify-between gap-3 rounded-box border px-4 py-3.5 max-sm:px-3.5 {blocking
        ? 'border-danger/40 bg-danger-soft'
        : 'border-warn/40 bg-warn-soft'}"
    >
      {@render gapRow(blocking ? "danger" : "warn", findingLabel(finding.findingType), finding.requirementKey, finding.description)}
      <!-- Any open gap can become a fix task: a non-blocking finding can still
           be why the check does not recommend completion. -->
      {#if finding.resolutionStatus === "OPEN"}
        <form
          method="post"
          action="?/generateTask"
          class="shrink-0"
          use:enhance={() => {
            busy = finding.id;
            return async ({ update }) => {
              busy = null;
              await update();
            };
          }}
        >
          <input type="hidden" name="findingId" value={finding.id} />
          <button
            class="btn btn-sm btn-outline border-line-control bg-base-100"
            type="submit"
            disabled={busy !== null}
            title="Create a bounded fix task traceable to this requirement"
          >
            {#if busy === finding.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
            Create fix task
          </button>
        </form>
      {:else if finding.resolutionStatus === "TASK_GENERATED"}
        {#if finding.generatedTaskId}
          <a class="btn btn-ghost btn-sm shrink-0 gap-1.5 text-mint" href={`/projects/${projectId}/tasks/${finding.generatedTaskId}`}>
            <Check class="size-3.5" aria-hidden="true" />Fix task<ChevronRight class="size-3.5" aria-hidden="true" />
          </a>
        {:else}
          <span class="flex shrink-0 items-center gap-1.5 py-1.5 text-xs font-semibold text-mint"><Check class="size-3.5" aria-hidden="true" />Fix task created</span>
        {/if}
      {/if}
    </li>
  {/each}
{/snippet}

{#snippet runCheck(entry: Entry, label: string, compact = false)}
  {@const unbuilt = entry.gate.blockers.incomplete_tasks.length}
  <form
    method="post"
    action="?/run"
    class="shrink-0 {primaryId === entry.feature.id ? 'max-sm:w-full' : ''}"
    use:enhance={() => {
      busy = entry.feature.id;
      runningCheck = true;
      return async ({ update }) => {
        busy = null;
        runningCheck = false;
        await update();
      };
    }}
  >
    <input type="hidden" name="featureId" value={entry.feature.id} />
    <!-- compact: a quiet re-check shrinks to its icon on phones (the label stays for screen readers). -->
    <button
      class="btn {primaryId === entry.feature.id ? 'btn-primary max-sm:btn-lg max-sm:w-full' : unbuilt > 0 || entry.runs.length > 0 ? 'btn-ghost btn-sm' : 'btn-outline border-line-control'} {compact
        ? 'max-sm:btn-square max-sm:-me-2 max-sm:-mt-1.5 max-sm:size-11'
        : ''}"
      type="submit"
      disabled={busy !== null}
      title={unbuilt > 0
        ? `An AI check (a paid call). ${unbuilt} ${unbuilt === 1 ? "task isn't" : "tasks aren't"} built yet, so it will mostly list what is missing.`
        : "An AI check (a paid call) of the built work against the approved requirements"}
    >
      {#if busy === entry.feature.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Radar class="size-4" aria-hidden="true" />{/if}
      <span class={compact ? "max-sm:sr-only" : ""}>{busy === entry.feature.id ? "Checking…" : unbuilt > 0 && entry.runs.length === 0 ? "Check early" : label}</span>
    </button>
  </form>
{/snippet}

{#snippet checkProgress(entry: Entry)}
  <!-- The check reads every requirement in scope with AI: say so while it runs. -->
  <AiProgress
    active={busy === entry.feature.id && runningCheck}
    label="Checking the built work against the requirements"
    estimate="usually under two minutes"
  />
{/snippet}

{#snippet featureHead(entry: Entry, badge: { label: string; cls: string; icon: typeof Check }, big: boolean)}
  <div class="flex min-w-0 flex-col gap-2">
    <span class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-xs font-medium tracking-tight text-base-content/75">{entry.feature.key}</span>
      <span class="badge badge-sm h-[22px] gap-1.5 rounded-field px-2.5 text-xs font-semibold whitespace-nowrap {badge.cls}">
        <badge.icon class="size-3 shrink-0" aria-hidden="true" />{badge.label}
      </span>
    </span>
    <h2 class="{big ? 'text-[20px] font-bold' : 'text-[16px] font-semibold'} leading-snug tracking-tight text-base-content">{entry.feature.title}</h2>
  </div>
{/snippet}

<!-- The closing moment: a complete feature reads as settled, not as another dashboard. -->
{#snippet completeCard(entry: Entry)}
  {@const latest = entry.runs[0]}
  {@const covered = latest ? latest.findings.filter((f) => f.findingType === "COVERED").length : 0}
  <section
    class="card flex flex-col gap-3 border border-line bg-base-100 px-5 py-4 max-sm:px-4 sm:px-6 {justCompleted === entry.feature.id ? 'settle' : ''}"
    aria-label={`${entry.feature.key} ${entry.feature.title}`}
  >
    <div class="flex items-start gap-3">
      <CircleCheck class="mt-0.5 size-5 shrink-0 text-mint" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-[14px] font-semibold">
          <span class="me-1.5 font-mono text-xs font-medium text-base-content/75">{entry.feature.key}</span>{entry.feature.title}
        </p>
        <p class="mt-0.5 text-[13px] text-base-content/80">
          Complete and verified{#if latest}, checked <time datetime={latest.run.createdAt}>{checkedAt(latest.run.createdAt)}</time>{/if}.
        </p>
      </div>
    </div>
    <ul class="flex flex-wrap gap-x-4 gap-y-1 ps-8 text-xs text-base-content/80">
      {#if covered > 0}
        <li class="flex items-center gap-1.5"><Check class="size-3 text-base-content/75" aria-hidden="true" />{covered} {s(covered, "requirement", "requirements")} covered</li>
      {/if}
      <li class="flex items-center gap-1.5"><Check class="size-3 text-base-content/75" aria-hidden="true" />Every task done</li>
      {#if entry.gate.blockers.blocking_bugs.length > 0}
        <!-- Completion is a snapshot; a bug confirmed afterwards still shows. -->
        <li class="flex items-center gap-1.5 font-medium text-warn">
          <TriangleAlert class="size-3" aria-hidden="true" />{entry.gate.blockers.blocking_bugs.length} confirmed {s(entry.gate.blockers.blocking_bugs.length, "bug", "bugs")} since
        </li>
      {:else}
        <li class="flex items-center gap-1.5"><Check class="size-3 text-base-content/75" aria-hidden="true" />No open bugs</li>
      {/if}
    </ul>
  </section>
{/snippet}

<main class="flex flex-col gap-7 sm:gap-8">
  {#if form?.notice}
    <Notice tone="success">{form.notice}</Notice>
  {:else if form?.message}
    <Notice tone="error">{form.message}</Notice>
  {/if}

  <header class="flex flex-col gap-2">
    <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
      {#if totalFeatures === 0}
        No features to check yet.
      {:else if completedFeatures === totalFeatures}
        All {totalFeatures} {s(totalFeatures, "feature is", "features are")} <span class="text-primary-ink">complete</span>.
      {:else if readyEntries.length > 0}
        {readyEntries.length} {s(readyEntries.length, "feature is", "features are")} ready to <span class="text-primary-ink">complete</span>{#if gapEntries.length > 0}, {gapEntries.length} {s(gapEntries.length, "has", "have")} gaps{/if}.
      {:else if gapEntries.length > 0}
        {gapEntries.length} {s(gapEntries.length, "feature has", "features have")} gaps to fix.
      {:else if stillToBuild > 0}
        {stillToBuild} {s(stillToBuild, "task", "tasks")} still to build.
      {:else}
        {uncheckedEntries.length} {s(uncheckedEntries.length, "feature is", "features are")} ready for a check.
      {/if}
    </h1>
    {#if totalFeatures === 0}
      <p class="text-[13px] text-base-content/80">Features arrive with the generated tasks.</p>
    {/if}
  </header>

  {#if totalFeatures > 0}
    <div class="grid items-start gap-7 {gapEntries.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_400px]' : 'max-w-[760px]'}">
      {#if gapEntries.length > 0}
        <div class="flex min-w-0 flex-col gap-5">
          {#each gapEntries as entry (entry.feature.id)}
            {@const b = entry.gate.blockers}
            {@const latest = entry.runs[0]}
            {@const listed = new Set((latest?.findings ?? []).map((f) => f.id))}
            {@const olderBlocking = b.open_blocking_findings.filter((f) => !listed.has(f.id))}
            <section class="card flex flex-col gap-4 border border-line bg-base-100 px-5 py-5 max-sm:px-4 sm:px-7 sm:py-6">
              <header class="flex flex-wrap items-start justify-between gap-3 max-sm:flex-nowrap">
                {@render featureHead(entry, { label: "Gaps to fix", cls: "border-warn/40 bg-warn-soft text-warn", icon: TriangleAlert }, true)}
                {#if !b.no_tasks}{@render runCheck(entry, "Check again", true)}{/if}
              </header>
              {@render checkProgress(entry)}

              <ul class="flex flex-col gap-2.5">
                {@render findingRows(entry)}
                {#each olderBlocking as f (f.id)}
                  <li class="rounded-box border border-danger/40 bg-danger-soft px-4 py-3.5">
                    {@render gapRow("danger", "Missing from requirements", null, f.description)}
                  </li>
                {/each}
                {#each b.blocking_bugs as bug (bug.id)}
                  <li class="flex flex-col gap-3 rounded-box border border-warn/40 bg-warn-soft px-4 py-3.5 max-sm:relative max-sm:min-h-16 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:px-3.5 sm:flex-row sm:items-center sm:justify-between">
                    {@render gapRow("warn", "Open bug", bug.key, bug.title)}
                    <a
                      class="btn btn-ghost btn-sm shrink-0 self-start max-sm:static max-sm:btn-square max-sm:self-center max-sm:after:absolute max-sm:after:inset-0 max-sm:after:rounded-box sm:self-auto"
                      href={`/projects/${projectId}/bugs`}
                      ><span class="max-sm:sr-only">Open bugs</span><ChevronRight class="size-4 text-base-content/60 sm:hidden" aria-hidden="true" /></a
                    >
                  </li>
                {/each}
                {#if b.incomplete_tasks.length > 0}
                  <li class="flex flex-col gap-3 rounded-box border border-line bg-base-200 px-4 py-3.5 max-sm:relative max-sm:min-h-16 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:px-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <span class="flex min-w-0 flex-col gap-1">
                      <span class="text-[13px] font-semibold">{b.incomplete_tasks.length} {s(b.incomplete_tasks.length, "task", "tasks")} unfinished</span>
                      <span class="font-mono text-xs text-base-content/80">
                        {b.incomplete_tasks.map((t) => t.key).slice(0, 4).join(", ")}{b.incomplete_tasks.length > 4 ? ` and ${b.incomplete_tasks.length - 4} more` : ""}
                      </span>
                    </span>
                    <a
                      class="btn btn-ghost btn-sm shrink-0 self-start max-sm:static max-sm:btn-square max-sm:self-center max-sm:after:absolute max-sm:after:inset-0 max-sm:after:rounded-box sm:self-auto"
                      href={`/projects/${projectId}/board`}
                      ><span class="max-sm:sr-only">Open board</span><ChevronRight class="size-4 text-base-content/60 sm:hidden" aria-hidden="true" /></a
                    >
                  </li>
                {/if}
                {#if actionable(entry).length + olderBlocking.length + b.blocking_bugs.length + b.incomplete_tasks.length === 0}
                  <!-- Nothing hard blocks, but the check did not recommend completion. -->
                  <li class="rounded-box border border-warn/40 bg-warn-soft px-4 py-3.5">
                    {@render gapRow("warn", "Not recommended yet", null, "Fix what the last check found, then check again.")}
                  </li>
                {/if}
              </ul>

              {#if latest}
                <details class="group text-[13px]">
                  <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
                    <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
                    Checked <time datetime={latest.run.createdAt}>{checkedAt(latest.run.createdAt)}</time>
                  </summary>
                  {#if latest.run.summary}
                    <p class="mt-1.5 ps-5 leading-relaxed text-base-content/80">{latest.run.summary}</p>
                  {/if}
                </details>
              {/if}
            </section>
          {/each}
        </div>
      {/if}

      <div class="flex min-w-0 flex-col gap-4">
        {#each readyEntries as entry (entry.feature.id)}
          {@const latest = entry.runs[0]}
          <section class="card flex flex-col gap-4 border bg-base-100 px-5 py-5 max-sm:px-4 sm:px-7 sm:py-6 {primaryId === entry.feature.id ? 'border-primary-ink' : 'border-line'}">
            {@render featureHead(entry, { label: "Ready", cls: "border-mint/40 bg-mint-soft text-mint", icon: CircleCheck }, true)}
            {#if latest}
              <p class="-mt-2 text-xs text-base-content/75">Checked <time datetime={latest.run.createdAt}>{checkedAt(latest.run.createdAt)}</time></p>
            {/if}
            <!-- Completing is final for the release view: confirm it first. -->
            <button
              class="btn w-full {primaryId === entry.feature.id ? 'btn-primary btn-lg' : 'btn-outline border-line-control'}"
              type="button"
              disabled={busy !== null}
              onclick={() => (confirming = { id: entry.feature.id, key: entry.feature.key, title: entry.feature.title })}
            >
              {#if busy === entry.feature.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Lock class="size-4" aria-hidden="true" />{/if}
              Mark {entry.feature.key} complete
            </button>
            {#if actionable(entry).length > 0}
              <details class="group">
                <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
                  <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
                  {actionable(entry).length} minor {s(actionable(entry).length, "finding", "findings")}
                </summary>
                <ul class="mt-2 flex flex-col gap-2.5">{@render findingRows(entry)}</ul>
              </details>
            {/if}
          </section>
        {/each}

        {#if settledEntry}
          {@render completeCard(settledEntry)}
        {/if}

        {#each uncheckedEntries as entry (entry.feature.id)}
          {@const b = entry.gate.blockers}
          {@const badge = b.no_tasks
            ? { label: "No tasks", cls: "border-line bg-base-200 text-base-content/80", icon: CircleDashed }
            : b.incomplete_tasks.length > 0
              ? { label: "Still building", cls: "border-line bg-base-200 text-base-content/80", icon: Hammer }
              : { label: "Not checked", cls: "border-line bg-base-200 text-base-content/80", icon: Radar }}
          <section class="card flex flex-col gap-3 border bg-base-100 px-5 py-4 max-sm:px-4 sm:px-7 sm:py-5 {primaryId === entry.feature.id ? 'border-primary-ink' : 'border-line'}">
            <div class="flex flex-wrap items-start justify-between gap-3">
              {@render featureHead(entry, badge, false)}
              {#if !b.no_tasks}
                {@render runCheck(entry, "Run release check")}
              {/if}
            </div>
            {#if b.no_tasks}
              <!-- No task traces to this feature's requirements: nothing to check. -->
              <p class="text-[13px] text-base-content/80">No task covers its requirements yet. Generate tasks again, or link one.</p>
            {:else if b.incomplete_tasks.length > 0}
              <p class="font-mono text-xs text-base-content/80">
                <span class="font-sans">{b.incomplete_tasks.length} unfinished:</span>
                {b.incomplete_tasks.map((t) => t.key).slice(0, 4).join(", ")}{b.incomplete_tasks.length > 4 ? ` and ${b.incomplete_tasks.length - 4} more` : ""}
              </p>
            {/if}
            {@render checkProgress(entry)}
          </section>
        {/each}

        {#if doneEntries.length}
          <details class="group">
            <summary class="btn btn-ghost list-none justify-start [&::-webkit-details-marker]:hidden">
              <ChevronDown class="size-4 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
              Complete
              <span class="font-normal tabular-nums text-base-content/75">{doneEntries.length}</span>
            </summary>
            <div class="mt-3 flex flex-col gap-3">
              {#each doneEntries as entry (entry.feature.id)}
                {@render completeCard(entry)}
              {/each}
            </div>
          </details>
        {/if}
      </div>
    </div>
  {/if}
</main>

<!-- Confirm "Mark feature complete" -->
<Modal
  open={confirming !== null}
  dismissible={busy === null}
  onclose={() => (confirming = null)}
  labelledby="complete-feature-title"
  describedby="complete-feature-desc"
  class="max-sm:modal-bottom"
  boxClass="flex max-w-[480px] flex-col gap-6 rounded-box border border-line p-6 max-sm:max-w-none max-sm:rounded-b-none max-sm:px-4 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-8"
>
  {#if confirming}
    {@const target = confirming}
    <div class="flex flex-col gap-2">
      <h2 id="complete-feature-title" class="text-[24px] leading-tight font-extrabold tracking-tight text-base-content">Mark {target.key} complete?</h2>
      <p id="complete-feature-desc" class="text-[13px] leading-relaxed text-base-content/80">
        “{target.title}” is recorded as complete and verified. Its check and tasks stay in the history.
      </p>
    </div>
    <form
      method="post"
      action="?/complete"
      use:enhance={() => {
        busy = target.id;
        return async ({ result, update }) => {
          busy = null;
          confirming = null;
          if (result.type === "success") justCompleted = target.id;
          await update();
        };
      }}
      class="flex items-center justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch"
    >
      <input type="hidden" name="featureId" value={target.id} />
      <button type="button" class="btn btn-ghost" onclick={() => (confirming = null)} disabled={busy !== null}>Cancel</button>
      <button class="btn btn-primary max-sm:btn-lg" type="submit" disabled={busy !== null}>
        {#if busy === target.id}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Lock class="size-4" aria-hidden="true" />{/if}
        <span>Mark complete</span>
      </button>
    </form>
  {/if}
</Modal>
