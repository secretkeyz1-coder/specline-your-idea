<script lang="ts">
  import {
    Archive,
    ArrowRight,
    Check,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    CircleDashed,
    Eye,
    FlaskConical,
    Hammer,
    Lock,
    Pen,
    Plus,
    Rocket,
    Search,
    Wand2,
    X,
  } from "lucide-svelte";
  import { HIDDEN_NEXT_COOKIE } from "$lib/today.js";
  import { untrack } from "svelte";
  import { tick } from "svelte";
  import { enhance } from "$app/forms";
  import Notice from "$lib/components/Notice.svelte";
  import { projectStage, type ProjectProgress } from "$lib/labels.js";
  import type { Journey, MilestoneState } from "$lib/journey.js";

  type Project = {
    id: string;
    key: string;
    name: string;
    lifecycleStatus: string;
    updatedAt: string;
    archivedAt?: string | null;
    progress?: ProjectProgress;
  };

  let {
    data,
    form,
  }: {
    data: {
      projects: Project[];
      /** The most recently touched live project and its next step. */
      focus: { projectId: string; journey: Journey } | null;
      ai: { state: "ready" | "partial" | "missing" | "managed"; bound: number; required: number; connections: number; profiles: number };
      hiddenNext: string | null;
    };
    form: { message?: string; notice?: string; archivedIds?: string[] } | null;
  } = $props();

  let projectName = $state("");
  let projectIdea = $state("");
  let projectConstraints = $state("");
  let creating = $state(false);
  let selectedPreset = $state<string | null>(null);

  // Examples the user may pick; the composer itself always starts empty.
  const templates = [
    {
      id: "field-ops",
      label: "Field Ops Mobile",
      name: "Field Operations App",
      idea: "A mobile-first offline app for field engineers to capture geotagged photo evidence, manage inspection work orders, and request manager sign-offs with automatic cloud synchronization.",
      constraints: "Offline-first\nMobile viewport\nSQLite local cache",
    },
    {
      id: "event-stream",
      label: "Event Streaming",
      name: "Telemetry Pipeline Service",
      idea: "A high-throughput event processing backend that ingests IoT telemetry, runs anomaly detection windows, and publishes alerts to Slack and webhooks with guaranteed at-least-once delivery.",
      constraints: "Sub-50ms latency\nZero data loss\nStrict type contracts",
    },
    {
      id: "cli-tool",
      label: "Developer CLI",
      name: "Cloud Config Linter",
      idea: "A standalone developer CLI tool that inspects infrastructure definitions against company security baselines, generates SARIF reports, and suggests automated autofixes for PR pipelines.",
      constraints: "Zero external runtime dependencies\nSingle binary\nCross-platform",
    },
  ];

  function applyTemplate(t: (typeof templates)[0]) {
    selectedPreset = t.id;
    projectName = t.name;
    projectIdea = t.idea;
    projectConstraints = t.constraints;
  }

  // ── Today: one next step, what is waiting on you, then every live project.
  const byActivity = $derived([...data.projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  const live = $derived(byActivity.filter((p) => !p.archivedAt));
  const archived = $derived(byActivity.filter((p) => p.archivedAt));
  const focusProject = $derived(data.focus ? (live.find((p) => p.id === data.focus!.projectId) ?? null) : null);
  const focusNext = $derived(data.focus?.journey.next ?? null);
  const focusChapter = $derived(data.focus ? (data.focus.journey.milestones.find((m) => m.id === data.focus!.journey.next.milestone) ?? null) : null);
  const focusDone = $derived(data.focus ? data.focus.journey.milestones.filter((m) => m.state === "done" || m.state === "skipped").length : 0);

  type Tone = "warn" | "sky" | "primary" | "violet";
  // What a project is waiting on the user for, from its lifecycle and task counts.
  // `action` groups the list; `detail` is what differs between projects in a group.
  type Waiting = { action: string; detail?: string; href: string; tone: Tone };
  function waitingFor(p: Project): Waiting | null {
    const base = `/projects/${p.id}`;
    const review = p.progress?.tasks_review ?? 0;
    if (review > 0) return { action: "Review tasks", detail: `${review} ${review === 1 ? "task" : "tasks"}`, href: `${base}/board`, tone: "warn" };
    switch (p.lifecycleStatus) {
      case "NEEDS_USER_INPUT":
        return { action: "Needs your input", href: base, tone: "violet" };
      case "REQUIREMENTS_DRAFT":
        return { action: "Approve requirements", href: `${base}/docs?tab=requirements`, tone: "warn" };
      case "DESIGN_DRAFT":
        return { action: "Approve technical design", href: `${base}/docs?tab=design`, tone: "warn" };
      case "TASK_REVIEW":
        return { action: "Approve tasks", href: `${base}/tasks`, tone: "warn" };
      case "STACK_SELECTION":
        return { action: "Lock the stack", href: `${base}/stack`, tone: "primary" };
      case "DISCOVERY_ACTIVE":
        return { action: "Answer discovery questions", href: `${base}/discovery`, tone: "sky" };
      default:
        return null;
    }
  }
  // Groups in this order (reviews first); projects keep their activity order inside a group.
  const ACTION_ORDER = ["Review tasks", "Needs your input", "Approve requirements", "Approve technical design", "Approve tasks", "Lock the stack", "Answer discovery questions"];
  const TONE_BAR: Record<Tone, string> = { warn: "bg-warn", sky: "bg-sky", primary: "bg-primary", violet: "bg-violet" };
  const waiting = $derived(
    live
      .filter((p) => p.id !== data.focus?.projectId)
      .map((p) => ({ project: p, what: waitingFor(p) }))
      .filter((x): x is { project: Project; what: Waiting } => x.what !== null)
      .sort((a, b) => ACTION_ORDER.indexOf(a.what.action) - ACTION_ORDER.indexOf(b.what.action)),
  );
  let showAllWaiting = $state(false);
  // The shown rows, grouped by action: many projects waiting on the same thing
  // read as one heading with a count instead of the same line again and again.
  const waitingGroups = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const item of waiting) counts.set(item.what.action, (counts.get(item.what.action) ?? 0) + 1);
    const groups: Array<{ action: string; tone: Tone; total: number; items: typeof waiting }> = [];
    for (const item of showAllWaiting ? waiting : waiting.slice(0, 5)) {
      const last = groups.at(-1);
      if (last?.action === item.what.action) last.items.push(item);
      else groups.push({ action: item.what.action, tone: item.what.tone, total: counts.get(item.what.action)!, items: [item] });
    }
    return groups;
  });
  // Projects that can't move until the person acts: the "Up next" one plus every one waiting.
  const needCount = $derived(waiting.length + (focusProject && focusNext ? 1 : 0));
  // What they wait on, by action, for the line under the headline ("Review tasks 12 · Approve requirements 8").
  const needBreakdown = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const item of waiting) counts.set(item.what.action, (counts.get(item.what.action) ?? 0) + 1);
    return [...counts].map(([action, n]) => `${action} ${n}`);
  });

  // "Up next" can be hidden; it stays hidden for that step only, so a new next step shows again.
  const focusKey = $derived(data.focus && focusNext ? `${data.focus.projectId}:${focusNext.milestone}:${focusNext.title}` : null);
  let hiddenKey = $state(untrack(() => data.hiddenNext));
  const heroHidden = $derived(focusKey !== null && hiddenKey === focusKey);
  function setHeroHidden(hide: boolean) {
    hiddenKey = hide ? focusKey : null;
    document.cookie = hide && focusKey
      ? `${HIDDEN_NEXT_COOKIE}=${encodeURIComponent(focusKey)}; path=/; max-age=2592000; samesite=lax`
      : `${HIDDEN_NEXT_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  // One status per project card: icon + word, colour supplemental.
  function stageBadge(p: Project) {
    const label = projectStage(p.lifecycleStatus, p.progress);
    if (label === "Complete") return { label, icon: CircleCheck, cls: "text-mint bg-mint-soft border-mint/40" };
    if (label.startsWith("Release check")) return { label, icon: FlaskConical, cls: "text-violet bg-violet-soft border-violet/40" };
    if (label.startsWith("Building") || label === "Built") return { label, icon: Hammer, cls: "text-sky bg-sky-soft border-sky/40" };
    if ((p.progress?.tasks_review ?? 0) > 0) return { label, icon: Eye, cls: "text-warn bg-warn-soft border-warn/40" };
    if (["REQUIREMENTS_DRAFT", "DESIGN_DRAFT", "TASK_REVIEW", "NEEDS_USER_INPUT"].includes(p.lifecycleStatus))
      return { label, icon: Pen, cls: "text-warn bg-warn-soft border-warn/40" };
    return { label, icon: CircleDashed, cls: "text-base-content/80 bg-base-200 border-line" };
  }

  const SEGMENT: Record<MilestoneState, string> = {
    done: "bg-mint border-mint",
    skipped: "bg-line-control border-line-control",
    draft: "bg-warn border-warn",
    current: "bg-primary border-primary",
    todo: "bg-base-300 border-line",
  };

  let query = $state("");
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? live.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) : live;
  });
  let selected = $state<string[]>([]);
  let archiving = $state(false);
  let view = $state<"active" | "archived">("active");

  // Clutter the user can clear in one go — only ever proposed: "Select them"
  // ticks the boxes, and the Archive bar (with Undo) does the rest.
  // Older copies: every live project whose name a newer live project also has.
  const olderCopies = $derived.by(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const p of live) {
      const name = p.name.trim().toLowerCase();
      if (seen.has(name)) ids.push(p.id);
      else seen.add(name);
    }
    return ids;
  });
  const copiedNames = $derived(new Set(live.filter((p) => olderCopies.includes(p.id)).map((p) => p.name.trim().toLowerCase())).size);
  const DAY = 86_400_000;
  const untouched = $derived(
    live.filter((p) => !olderCopies.includes(p.id) && p.id !== data.focus?.projectId && Date.now() - Date.parse(p.updatedAt) > 14 * DAY).map((p) => p.id),
  );
  let listEl = $state<HTMLElement | null>(null);
  function selectForArchive(ids: string[]) {
    selected = [...ids];
    query = "";
    view = "active";
    listEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Phones: "New" sits by the list, so the opened composer is brought into view.
  async function toggleComposerFromList() {
    composerShown = !composerShown;
    if (!composerShown) return;
    await tick();
    document.getElementById("project-name")?.focus();
  }
  // Fixed locale + zone so server and browser render the same string.
  const updatedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  // ── First run: no projects yet. The path is derived from real state, so it
  // disappears by itself once the first project exists (nothing to dismiss).
  const firstRun = $derived(data.projects.length === 0);
  const aiReady = $derived(data.ai.state === "ready" || data.ai.state === "managed");
  // AI is set up first (product decision); starting without it stays possible
  // because every planning step has a manual path — it's just not the default.
  let startWithoutAi = $state(false);
  const composerOpen = $derived(!firstRun || aiReady || startWithoutAi);
  // On Today the composer is one click away; a create error keeps it open.
  let composerShown = $state(false);
  const showComposer = $derived(composerShown || Boolean(form?.message && !form?.notice && !form?.archivedIds));

  const aiStepDetail = $derived(
    data.ai.state === "managed"
      ? "Your workspace admin manages AI."
      : data.ai.state === "partial"
        ? `${data.ai.bound} of ${data.ai.required} planning roles have a model.`
        : "Add an API key and pick a model.",
  );

  const steps = $derived([
    { title: "Connect an AI provider", detail: aiStepDetail, state: aiReady ? "done" : "current", bar: "w-[116px]" },
    { title: "Describe your idea", detail: "", state: aiReady || startWithoutAi ? "current" : "todo", bar: "w-[68px]" },
    { title: "Approve the plan", detail: "", state: "todo", bar: "w-[92px]" },
    { title: "Hand off the first task", detail: "", state: "todo", bar: "" },
  ] as const);
</script>

<svelte:head>
  <title>{firstRun ? "Get started" : "Today"} — SDD Control Plane</title>
</svelte:head>

{#snippet composer()}
  <form
    method="post"
    action="?/create"
    use:enhance={() => {
      creating = true;
      return async ({ update }) => {
        creating = false;
        await update({ reset: false });
      };
    }}
    class="card flex flex-col gap-5 rounded-box border border-line bg-base-100 p-5 max-sm:gap-4 max-sm:p-4 sm:p-8"
  >
    <div class="flex flex-col gap-2">
      <label for="project-name" class="text-[14px] font-semibold text-base-content">Project name</label>
      <input
        id="project-name"
        class="input h-12 w-full border-line-control text-[16px] font-semibold"
        type="text"
        name="name"
        required
        placeholder="e.g. Field Operations App"
        maxlength="160"
        bind:value={projectName}
      />
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-2">
        <label for="project-idea" class="text-[14px] font-semibold text-base-content">The idea</label>
        <span class="text-xs text-base-content/80">One paragraph is enough</span>
      </div>
      <textarea
        id="project-idea"
        class="textarea min-h-[170px] w-full resize-y rounded-box border-line-control px-4 py-3.5 text-[16px] leading-relaxed sm:text-[15px]"
        name="idea"
        required
        minlength="10"
        placeholder="Who is it for, what should they be able to do, and what does done look like?"
        bind:value={projectIdea}
      ></textarea>
    </div>

    <div class="flex flex-col gap-2">
      <label for="project-constraints" class="text-[14px] font-semibold text-base-content">
        Constraints <span class="font-normal text-base-content/75">(optional, one per line)</span>
      </label>
      <textarea
        id="project-constraints"
        class="textarea min-h-[104px] w-full resize-y rounded-box border-line-control px-4 py-3 font-mono text-[16px] leading-relaxed sm:text-[13px]"
        name="constraints"
        placeholder="e.g. Must work offline&#10;Node.js 22 LTS&#10;PostgreSQL"
        bind:value={projectConstraints}
      ></textarea>
    </div>

    <details class="group text-[13px]">
      <summary class="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
        <Wand2 class="size-3.5" aria-hidden="true" />Try an example<ChevronDown class="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div class="mt-1 flex flex-wrap gap-1.5">
        {#each templates as t}
          <button
            type="button"
            aria-pressed={selectedPreset === t.id}
            class="btn btn-sm rounded-field text-xs font-medium {selectedPreset === t.id ? 'border-primary-ink bg-primary-soft text-base-content' : 'btn-outline border-line-control text-base-content/80'}"
            onclick={() => applyTemplate(t)}
          >
            {t.label}
          </button>
        {/each}
      </div>
    </details>

    {#if firstRun && !aiReady && startWithoutAi}
      <p class="text-[13px] text-base-content/80" role="status">
        You'll write requirements and design by hand.
        <a class="font-medium text-base-content underline underline-offset-4" href="/settings/ai?from=start">Set up AI</a> any time.
      </p>
    {/if}

    {#if form?.message && !form?.notice}
      <Notice tone="error">{form.message}</Notice>
    {/if}

    <div class="flex flex-col gap-3 border-t border-line pt-5 max-sm:gap-2 max-sm:pt-4">
      <button class="btn {composerOpen ? 'btn-primary' : ''} btn-lg h-12 w-full text-[15px]" type="submit" disabled={!composerOpen || creating}>
        {#if creating}
          <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
          <span>Creating project…</span>
        {:else}
          <Rocket class="size-4" aria-hidden="true" />
          <span>Create project</span>
        {/if}
      </button>
      {#if !composerOpen}
        <!-- The primary action is step 1 on the left; this is the quiet alternative. -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="inline-flex items-center gap-1.5 text-xs text-base-content/75"><Lock class="size-3.5" aria-hidden="true" />Connect AI first</span>
          <button type="button" class="btn btn-ghost btn-sm px-1 underline underline-offset-4" onclick={() => (startWithoutAi = true)}>Start without AI</button>
        </div>
      {/if}
    </div>
  </form>
{/snippet}

{#if firstRun}
  <main class="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <!-- Left: the whole path, drawn as the logo's spec lines -->
    <section class="border-b border-line bg-base-300 px-4 py-8 max-sm:border-b-0 max-sm:bg-transparent max-sm:pt-6 max-sm:pb-0 sm:px-8 sm:py-10 lg:border-r lg:border-b-0 lg:px-14 lg:py-16" aria-labelledby="first-run-title">
      <h1 id="first-run-title" class="max-w-[16ch] font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-balance text-base-content sm:text-[32px]">
        From your idea to a work order an agent can run.
      </h1>

      <!-- Phones: the path is one bordered card, its lines drawn as four segments on top. -->
      <div class="mt-10 lg:mt-14 max-sm:mt-6 max-sm:flex max-sm:flex-col max-sm:gap-3.5 max-sm:rounded-box max-sm:border max-sm:border-primary-ink max-sm:bg-base-100 max-sm:p-4">
      <div class="grid grid-cols-4 gap-1 sm:hidden" aria-hidden="true">
        {#each steps as step (step.title)}
          <span class="block h-2 rounded-full {step.state === 'done' ? 'bg-mint' : step.state === 'current' ? 'bg-primary' : 'bg-line-control'}"></span>
        {/each}
      </div>
      <ol class="flex flex-col gap-7 max-sm:gap-2.5" aria-label="Getting started">
        {#each steps as step, i (step.title)}
          <li class="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4 max-sm:grid-cols-[17px_minmax(0,1fr)] max-sm:gap-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-6" aria-current={step.state === "current" ? "step" : undefined}>
            <div class="flex items-center gap-2.5 pt-1" aria-hidden="true">
              <span class="font-mono text-xs font-medium {step.state === 'todo' ? 'text-base-content/75' : 'text-primary-ink'}">0{i + 1}</span>
              {#if step.bar}
                <span class="block h-3 max-w-full rounded-full max-sm:hidden {step.bar} {step.state === 'done' ? 'bg-mint' : step.state === 'current' ? 'bg-primary' : 'bg-line-control'}"></span>
              {:else}
                <span class="block size-4 rounded-full border-2 border-line-control max-sm:hidden"></span>
              {/if}
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <p class="flex items-center gap-1.5 text-[15px] font-semibold max-sm:text-[14px] {step.state === 'current' ? 'text-[16px] font-bold text-base-content max-sm:text-[16px]' : step.state === 'done' ? 'text-base-content/80' : 'text-base-content'}">
                {#if step.state === "done"}<Check class="size-4 text-mint" strokeWidth={3} aria-hidden="true" /><span class="sr-only">Done:</span>{/if}
                {step.title}
              </p>
              {#if step.detail && step.state === "current"}
                <p class="text-[13px] leading-relaxed text-base-content/80">{step.detail}</p>
              {/if}
              {#if i === 0 && !aiReady}
                <a class="btn {startWithoutAi ? 'btn-outline border-line-control' : 'btn-primary'} btn-lg mt-3 self-start max-sm:-ms-[29px] max-sm:mt-2.5 max-sm:w-[calc(100%+29px)]" href="/settings/ai?from=start">
                  Connect AI<ArrowRight class="size-4" aria-hidden="true" />
                </a>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
      </div>
    </section>

    <!-- Right: the idea composer -->
    <section class="min-w-0 px-4 py-8 max-sm:pt-7 sm:px-8 sm:py-10 lg:px-14 lg:py-16" aria-labelledby="composer-title">
      <div class="mx-auto flex w-full max-w-[620px] flex-col gap-5 max-sm:gap-3">
        <h2 id="composer-title" class="font-display text-[24px] leading-tight font-extrabold tracking-tight text-base-content max-sm:text-[20px] max-sm:font-bold sm:text-[28px]">Describe the idea</h2>
        {@render composer()}
      </div>
    </section>
  </main>
{:else}
  <main class="mx-auto w-full max-w-[1240px] px-4 py-8 max-sm:pt-6 sm:px-6 sm:py-10 lg:px-12">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-base-content sm:text-[32px]">
        {#if needCount > 0}
          {needCount} {needCount === 1 ? "project is" : "projects are"} waiting on you.
        {:else}
          Nothing needs you.
        {/if}
      </h1>
      <div class="flex flex-wrap items-center gap-2">
        {#if heroHidden}
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => setHeroHidden(false)}>
            <Eye class="size-4" aria-hidden="true" />Show up next
          </button>
        {/if}
      <!-- Starting something new is always one quiet click away; it never competes with the next step. -->
      <button type="button" class="btn btn-ghost border-line-control max-sm:hidden" aria-expanded={showComposer} aria-controls="today-composer" onclick={() => (composerShown = !composerShown)}>
        <Plus class="size-4" aria-hidden="true" />New project
      </button>
      </div>
    {#if needCount > 0}
      <!-- What the count is: each project blocked on you, by what it waits for. -->
      <p class="mt-1.5 max-w-[72ch] text-[14px] text-base-content/80">
        {#if focusProject && focusNext}1 up next (<span class="text-base-content">{focusProject.name}</span>){#if waiting.length}{" "}and{" "}{/if}{/if}{#if waiting.length}{waiting.length} in Waiting on you: {needBreakdown.join(" · ")}{/if}.
      </p>
    {/if}
    </div>

    {#if form?.notice}
      <div class="mt-5 flex flex-wrap items-center gap-3 rounded-field border border-line bg-base-100 py-1.5 ps-4 pe-1.5 text-[13px]" role="status">
        <Check class="size-4 text-mint" aria-hidden="true" /><span class="flex-1">{form.notice}</span>
        {#if form.archivedIds?.length}
          <form method="post" action="?/archive" use:enhance>
            <input type="hidden" name="archived" value="0" />
            {#each form.archivedIds as id (id)}<input type="hidden" name="projectId" value={id} />{/each}
            <button class="btn btn-ghost btn-sm" type="submit">Undo</button>
          </form>
        {/if}
      </div>
    {:else if form?.message && !showComposer}
      <Notice tone="error" class="mt-5">{form.message}</Notice>
    {/if}

    <!-- One column below xl: next step, what is waiting on you, then the projects. -->
    <div class="mt-7 grid items-start gap-8 max-sm:mt-5 max-sm:gap-6 {waiting.length ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}">
      <div class="flex min-w-0 flex-col gap-8 max-xl:contents">
        {#if focusProject && focusNext && !heroHidden}
          <!-- Focus hero: the one next step, alone on stage. -->
          <section class="relative overflow-hidden rounded-box border border-primary-ink/40 bg-base-100 max-sm:border-primary-ink" aria-labelledby="focus-title">
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square absolute top-3 right-3 text-base-content/80 max-sm:size-11"
              aria-label="Hide up next"
              title="Hide until the next step changes"
              onclick={() => setHeroHidden(true)}
            >
              <X class="size-4" aria-hidden="true" />
            </button>
            <div class="flex min-w-0 flex-col gap-4 p-5 sm:px-8 sm:py-7">
              <span class="badge badge-sm self-start border-primary bg-primary font-semibold text-primary-content">Up next</span>
              <div class="flex flex-col gap-1">
                <h2 id="focus-title" class="font-display text-[22px] leading-snug font-bold tracking-tight text-base-content max-sm:text-[20px] sm:text-[26px]">{focusNext.title}</h2>
                <p class="text-[14px] text-base-content/80">
                  <a class="hover:text-base-content hover:underline" href={`/projects/${focusProject.id}`}>{focusProject.name}</a>{#if focusChapter}<span>{` · Chapter ${focusChapter.n} of 9, ${focusChapter.label}`}</span>{/if}
                </p>
              </div>
              {#if data.focus}
                <div class="flex flex-col gap-2">
                  <div class="grid grid-cols-9 gap-1" aria-hidden="true">
                    {#each data.focus.journey.milestones as m (m.id)}
                      <span class="h-2 rounded-full border {SEGMENT[m.state]}" title={m.label}></span>
                    {/each}
                  </div>
                  <p class="text-xs text-base-content/80 tabular-nums">{focusDone} of {data.focus.journey.milestones.length} chapters done</p>
                </div>
              {/if}
              <div class="mt-1 flex flex-wrap gap-2 max-sm:flex-col">
                <a class="btn btn-primary btn-lg max-sm:w-full" href={focusNext.href ?? `/projects/${focusProject.id}`}>
                  {focusNext.cta}<ArrowRight class="size-4" aria-hidden="true" />
                </a>
                <a class="btn btn-ghost btn-lg max-sm:w-full" href={`/projects/${focusProject.id}`}>Open notebook</a>
              </div>
            </div>
          </section>
        {/if}

        {#if showComposer}
          <section id="today-composer" aria-label="New project" class="max-w-[720px] max-xl:order-1 max-sm:scroll-mt-20">{@render composer()}</section>
        {/if}

        <!-- Every project; archive what you're done with -->
        <section class="flex scroll-mt-20 flex-col gap-3.5 max-xl:order-1 max-sm:gap-2.5" aria-labelledby="all-title" bind:this={listEl}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="all-title" class="text-[16px] font-semibold text-base-content">Your projects</h2>
            <div class="flex flex-wrap items-center gap-2">
              <!-- Phones: "New" sits with the list; the hero's big target is a desktop affordance. -->
              <button type="button" class="btn btn-outline btn-sm border-line-control sm:hidden" aria-expanded={showComposer} aria-controls="today-composer" onclick={toggleComposerFromList}>
                <Plus class="size-4" aria-hidden="true" />New
              </button>
              {#if view === "active" && live.length > 5}
                <label class="input input-sm w-full border-line-control text-[13px] sm:w-56">
                  <span class="sr-only">Filter projects</span>
                  <Search class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
                  <input class="grow" type="search" placeholder="Filter by name or key" bind:value={query} />
                </label>
              {/if}
              {#if archived.length}
                <div class="join" role="group" aria-label="Show">
                  <button type="button" class="btn btn-sm join-item {view === 'active' ? 'btn-active border-primary-ink bg-primary-soft' : 'border-line-control'}" aria-pressed={view === "active"} onclick={() => (view = "active")}>Active</button>
                  <button type="button" class="btn btn-sm join-item {view === 'archived' ? 'btn-active border-primary-ink bg-primary-soft' : 'border-line-control'}" aria-pressed={view === "archived"} onclick={() => (view = "archived")}>Archived · {archived.length}</button>
                </div>
              {/if}
            </div>
          </div>

          {#if view === "active"}
            {#if selected.length}
              <form
                method="post"
                action="?/archive"
                class="flex flex-wrap items-center gap-2 rounded-field border border-line bg-base-100 py-1.5 ps-4 pe-1.5 text-[13px]"
                use:enhance={() => {
                  archiving = true;
                  return async ({ update }) => {
                    archiving = false;
                    selected = [];
                    await update();
                  };
                }}
              >
                {#each selected as id (id)}<input type="hidden" name="projectId" value={id} />{/each}
                <span class="flex-1 font-medium">{selected.length} selected</span>
                <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={archiving}><Archive class="size-3.5" aria-hidden="true" />Archive</button>
                <button class="btn btn-sm btn-ghost" type="button" onclick={() => (selected = [])}>Clear</button>
              </form>
            {/if}

            {#if filtered.length === 0}
              <p class="text-[13px] text-base-content/80">{query.trim() ? `No project matches "${query.trim()}".` : "No live projects — everything is archived."}</p>
            {:else}
              <ul class="grid gap-4 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-box max-sm:border max-sm:border-line max-sm:bg-base-100 sm:grid-cols-2 lg:grid-cols-3" aria-label="Active projects">
                {#each filtered as project (project.id)}
                  {@const badge = stageBadge(project)}
                  {@const isSelected = selected.includes(project.id)}
                  <!-- Phones: one row per project — name, then status and key; the archive box on the right. -->
                  <li class="relative flex min-w-0 flex-col gap-3 rounded-box border bg-base-100 p-4 ps-5 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1 max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line max-sm:py-2.5 max-sm:ps-4 max-sm:pe-2 max-sm:last:border-b-0 {isSelected ? 'border-primary-ink max-sm:bg-primary-soft' : 'border-line hover:border-line-control'}">
                    <div class="flex items-start justify-between gap-2 max-sm:contents">
                      <span class="badge badge-sm mt-2.5 gap-1.5 font-semibold max-sm:order-3 max-sm:mt-0 max-sm:max-w-44 {badge.cls}">
                        <badge.icon class="size-3 shrink-0" aria-hidden="true" /><span class="max-sm:truncate">{badge.label}</span>
                      </span>
                      <label class="relative z-10 -me-2 -mt-1 grid size-11 shrink-0 cursor-pointer place-items-center max-sm:order-2 max-sm:row-span-2 max-sm:m-0">
                        <span class="sr-only">Select {project.name}</span>
                        <input type="checkbox" class="checkbox checkbox-sm" value={project.id} bind:group={selected} />
                      </label>
                    </div>
                    <a href={`/projects/${project.id}`} class="min-w-0 after:absolute after:inset-0 after:rounded-box max-sm:order-1 max-sm:col-span-2 max-sm:after:rounded-none">
                      <span class="block truncate text-[15px] font-semibold text-base-content">{project.name}</span>
                    </a>
                    <p class="truncate text-xs text-base-content/80 max-sm:order-4">
                      <span class="font-mono">{project.key}</span> · Updated <time datetime={project.updatedAt}>{updatedFormat.format(new Date(project.updatedAt))}</time>
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
            <!-- Housekeeping comes after the work: suggestions only, archiving stays the user's click. -->
            {#if !selected.length && (olderCopies.length || untouched.length)}
              <div class="flex flex-col gap-0.5 border-t border-line pt-3 text-[13px] text-base-content/80">
                {#if olderCopies.length}
                  <p class="flex flex-wrap items-center gap-x-2">
                    <span>{olderCopies.length} older {olderCopies.length === 1 ? "copy" : "copies"} of {copiedNames} {copiedNames === 1 ? "name" : "names"}</span>
                    <button type="button" class="btn btn-ghost btn-sm px-2 text-[13px]" onclick={() => selectForArchive(olderCopies)}>Select them</button>
                  </p>
                {/if}
                {#if untouched.length}
                  <p class="flex flex-wrap items-center gap-x-2">
                    <span>{untouched.length} untouched for two weeks</span>
                    <button type="button" class="btn btn-ghost btn-sm px-2 text-[13px]" onclick={() => selectForArchive(untouched)}>Select them</button>
                  </p>
                {/if}
              </div>
            {/if}
          {:else}
            <ul class="list rounded-box border border-line bg-base-100" aria-label="Archived projects">
              {#each archived as project (project.id)}
                <li class="list-row min-h-12 items-center gap-3 py-1.5 ps-4 pe-2">
                  <a class="list-col-grow min-w-0 truncate text-[14px] text-base-content/80 hover:text-base-content" href={`/projects/${project.id}`}>
                    {project.name} <span class="font-mono text-xs">{project.key}</span>
                  </a>
                  <form method="post" action="?/archive" use:enhance>
                    <input type="hidden" name="archived" value="0" />
                    <input type="hidden" name="projectId" value={project.id} />
                    <button class="btn btn-ghost btn-sm" type="submit">Restore</button>
                  </form>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>

      <!-- Right rail: other projects that can't move until you do something -->
      {#if waiting.length}
        <aside class="flex min-w-0 flex-col gap-3.5 rounded-box border border-line bg-base-100 p-5 max-sm:gap-2.5 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-labelledby="waiting-title">
          <h2 id="waiting-title" class="text-[15px] font-semibold text-base-content">Waiting on you</h2>
          <div class="flex flex-col gap-3">
            {#each waitingGroups as group (group.action)}
              <section class="flex flex-col gap-1" aria-label="{group.action}: {group.total} {group.total === 1 ? 'project' : 'projects'}">
                <h3 class="flex items-center gap-2 text-xs font-semibold text-base-content/80">
                  <span class="h-3 w-1 shrink-0 rounded-full {TONE_BAR[group.tone]}" aria-hidden="true"></span>
                  {group.action}
                  <span class="font-mono font-normal tabular-nums text-base-content/75">{group.total}</span>
                </h3>
                <ul class="flex flex-col max-sm:overflow-hidden max-sm:rounded-box max-sm:border max-sm:border-line max-sm:bg-base-100">
                  {#each group.items as item (item.project.id)}
                    <li class="max-sm:border-b max-sm:border-line max-sm:last:border-b-0">
                      <a
                        href={item.what.href}
                        class="-mx-2 flex min-h-11 items-center gap-2.5 rounded-box px-2 py-1 hover:bg-base-200 max-sm:mx-0 max-sm:min-h-13 max-sm:rounded-none max-sm:px-3.5 max-sm:py-2"
                        aria-label="{group.action}{item.what.detail ? ` (${item.what.detail})` : ''} — {item.project.key} {item.project.name}"
                      >
                        <!-- The key tells apart projects that share a name. -->
                        <span class="shrink-0 font-mono text-[11px] text-base-content/75">{item.project.key}</span>
                        <span class="min-w-0 grow truncate text-[13px] font-medium text-base-content max-sm:text-[14px]">{item.project.name}</span>
                        {#if item.what.detail}<span class="shrink-0 text-xs text-base-content/75 tabular-nums">{item.what.detail}</span>{/if}
                        <ChevronRight class="size-4 shrink-0 text-base-content/75 sm:hidden" aria-hidden="true" />
                      </a>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
          {#if waiting.length > 5}
            <button type="button" class="btn btn-ghost btn-sm self-start" onclick={() => (showAllWaiting = !showAllWaiting)}>
              {showAllWaiting ? "Show fewer" : `Show all ${waiting.length}`}
            </button>
          {/if}
        </aside>
      {/if}
    </div>
  </main>
{/if}
