<script lang="ts">
  import { untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { enhance } from "$app/forms";
  import { Sparkles, Lock, TriangleAlert, ChevronDown, ChevronRight, Wand2, User, X } from "lucide-svelte";
  import type { StackDecision, StackComponent, StackCatalog, StackPackage } from "$lib/types.js";
  import VerifiedNote from "$lib/components/stack/VerifiedNote.svelte";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import DecisionReceipt from "$lib/components/DecisionReceipt.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import NextStepBar from "$lib/components/NextStepBar.svelte";
  import type { Journey, Milestone, MilestoneId } from "$lib/journey.js";

  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; key: string; name: string };
      aiAvailable: boolean;
      approvedStack: {
        version: number;
        approvedAt: string | null;
        layers: StackComponent[];
        mode: StackDecision["mode"];
        candidate: string;
        rationale: string;
        fit: string;
        tradeoffs: StackDecision["candidates"][number]["tradeoffs"];
        conflicts: StackDecision["conflicts"];
      } | null;
      draftDecision: StackDecision | null;
      justLocked?: boolean;
      /** Per-layer choices with live release facts; streams in after the page. */
      catalog?: Promise<StackCatalog | null> | StackCatalog | null;
      /** From the project layout. */
      journey?: Journey;
    };
    form: { decision?: StackDecision; message?: string } | null;
  } = $props();

  // The layers the recommender covers; others (Realtime, Email, …) are added when the product needs them.
  const CORE_LAYERS = ["Frontend", "Backend / runtime", "Data access / ORM", "Database", "Auth", "Testing", "Deployment"];

  /** One layer being set by hand: a catalog option, or "other" with its own name, version and reason. */
  type Row = { category: string; core: boolean; choice: string; technology: string; version: string; why: string; pkg: StackPackage | null; locked: boolean };
  const emptyRow = (category: string, core: boolean): Row => ({ category, core, choice: "", technology: "", version: "", why: "", pkg: null, locked: false });

  // The catalog streams in after the page (its registry checks may be slow); until then a layer is typed.
  let catalog = $state<StackCatalog | null>(null);
  $effect(() => {
    const incoming = data.catalog;
    let alive = true;
    Promise.resolve(incoming)
      .then((c) => {
        if (alive) catalog = c ?? null;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });
  const optionsFor = (category: string) => catalog?.layers.find((l) => l.category === category)?.options ?? [];
  const optionOf = (row: Row) => (row.choice && row.choice !== "other" ? (optionsFor(row.category).find((o) => o.id === row.choice) ?? null) : null);
  /** "^5" from "5.2.1": the latest major, as the version the layer asks for. */
  const majorConstraint = (latest: string | null | undefined) => {
    const m = /(\d+)/.exec(latest ?? "");
    return m ? `^${m[1]}` : "";
  };
  const packageField = (p: StackPackage | null) => (p ? `${p.registry}:${p.name}` : "");
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  /** The package an option is checked as, when its name doesn't say so ("Auth.js" → @auth/core). */
  const checkedAs = (o: { name: string; package: StackPackage | null }) => {
    const plain = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    return o.package && !plain(o.package.name).includes(plain(o.name)) && !plain(o.name).includes(plain(o.package.name.split("/").pop() ?? "")) ? o.package.name : null;
  };
  const optionFor = (layer: StackComponent) =>
    optionsFor(layer.category).find(
      (o) => (layer.package && o.package && o.package.registry === layer.package.registry && sameName(o.package.name, layer.package.name)) || sameName(o.name, layer.technology),
    ) ?? null;
  /** Registry facts for a layer recorded without them (locked before verification existed): its catalog option's live check. */
  const liveVerified = (layer: StackComponent) => layer.verified ?? optionFor(layer)?.verified ?? null;

  function choose(row: Row, value: string) {
    row.choice = value;
    if (value === "other") {
      row.pkg = null;
      if (optionsFor(row.category).some((o) => o.name === row.technology)) row.technology = "";
      return;
    }
    const option = optionsFor(row.category).find((o) => o.id === value);
    row.technology = option?.name ?? "";
    row.version = option ? majorConstraint(option.verified?.latest_version) : "";
    row.pkg = option?.package ?? null;
    row.why = "";
  }

  /** Fill a row from a layer the AI proposed: its catalog option when it is one, else "other". */
  function fillFromLayer(row: Row, layer: StackComponent) {
    const option = optionsFor(row.category).find(
      (o) => (layer.package && o.package && o.package.registry === layer.package.registry && sameName(o.package.name, layer.package.name)) || sameName(o.name, layer.technology),
    );
    row.choice = option ? option.id : "other";
    row.technology = option ? option.name : layer.technology;
    row.version = layer.version_constraint ?? (option ? majorConstraint(option.verified?.latest_version) : "");
    row.pkg = option?.package ?? layer.package ?? null;
    row.why = option ? "" : (layer.rationale ?? "");
  }

  // "+ Add layer": the catalog's optional layers not on the list yet, or a custom one.
  const extraLayers = $derived((catalog?.layers ?? []).filter((l) => !l.core && !rows.some((r) => sameName(r.category, l.category))).map((l) => l.category));
  let customLayer = $state<string | null>(null);
  function addLayer(category: string) {
    const name = category.trim().slice(0, 64);
    if (!name || rows.some((r) => sameName(r.category, name))) return;
    rows.push(emptyRow(name, false));
    customLayer = null;
  }

  // Default to the mode that can actually succeed: with no AI profile bound,
  // start in the manual editor (C17/C21) instead of an AI button that always
  // fails. `untrack` states the intent explicitly — the starting mode is read
  // once, and the user is free to switch afterwards.
  let mode = $state<"RECOMMENDED" | "MANUAL">(untrack(() => (data.aiAvailable ? "RECOMMENDED" : "MANUAL")));
  let rows = $state<Row[]>(CORE_LAYERS.map((c) => emptyRow(c, true)));

  /** The layer the AI proposed for one category, from its recommended candidate. */
  function suggestedLayer(d: StackDecision | undefined, category: string): StackComponent | null {
    if (!d?.candidates?.length) return null;
    const candidate = d.candidates[d.recommendation_index ?? 0] ?? d.candidates[0];
    const layer = candidate?.layers.find((l) => l.category === category);
    return layer?.technology?.trim() ? layer : null;
  }
  let generating = $state(false);
  // Which AI action is running: "" for the whole-stack submit, or the layer
  // whose per-row suggestion was asked for. Every AI button is disabled while
  // any one of them runs, and only the clicked one says what it is doing.
  let suggesting = $state<string | null>(null);
  const progressLabel = $derived(
    suggesting ? `Suggesting a ${suggesting}` : mode === "MANUAL" ? "Checking your choices" : "Recommending a stack",
  );

  // Keep the last recommendation across a failed approval: the failure result
  // (`{ message }`) used to replace `form` and discard the paid AI decision.
  // Seeded from the server's newest unlocked recommendation, so a reload keeps it.
  let lastDecision = $state<StackDecision | null>(untrack(() => data.draftDecision));
  // True until the user asks for a new recommendation in this visit.
  let fromEarlierVisit = $state(untrack(() => data.draftDecision !== null));
  const restored = $derived(fromEarlierVisit && !form?.decision);

  // A locked stack always opens as locked; changing it is a deliberate step,
  // even when an unlocked recommendation newer than the lock is on record
  // (the locked view offers to continue it).
  let revising = $state(false);
  const showLocked = $derived(data.approvedStack !== null && !revising && !form?.decision);
  const nextVersion = $derived(data.approvedStack ? data.approvedStack.version + 1 : 1);
  const lockNote = $derived(
    data.approvedStack
      ? `Replaces v${data.approvedStack.version}. The design written against it needs a fresh look.`
      : "Locking is final. Changes later create v2.",
  );
  const approvedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

  // The locked view says why, what is built on it, and what comes next.
  // Mirrors DOWNSTREAM for the stack in DecisionReceipt (the API's order).
  const BUILT_ON: MilestoneId[] = ["design", "system", "tasks", "screens"];
  const builtOn = $derived(
    BUILT_ON.map((id) => data.journey?.milestones.find((m) => m.id === id)).filter((m): m is Milestone => m !== undefined),
  );
  const builtOnState = (m: Milestone) =>
    m.state === "draft" ? m.summary || "Draft waiting for approval" : m.state === "done" ? m.summary || "Done" : m.state === "skipped" ? "Skipped" : "Not started";
  // The next step belongs to a later chapter once the stack is locked; on this chapter the page itself is the step.
  const nextElsewhere = $derived(Boolean(data.journey && !data.journey.finished && data.journey.next.milestone !== "stack"));
  // Layer notes worth reading: the manual fallback writes the same line on every layer.
  const layerWhy = (l: { rationale?: string }) => (l.rationale && l.rationale !== "Chosen manually by the operator." ? l.rationale : "");
  $effect(() => {
    if (form?.decision) {
      lastDecision = form.decision;
      fromEarlierVisit = false;
    }
  });
  const decision = $derived(form?.decision ?? lastDecision);
  const recommended = $derived(
    decision && decision.recommendation_index !== null ? decision.candidates[decision.recommendation_index] : decision?.candidates[0] ?? null,
  );
  const chosen = $derived<StackComponent[]>(
    recommended ? recommended.layers.map((l) => ({ ...l, selection_source: decision?.mode === "MANUAL" ? "USER_SELECTED" : "AI_RECOMMENDED" })) : [],
  );

  /**
   * C17/C21 manual fallback: the approve block used to render ONLY from an AI
   * decision, so with no provider bound the user could never lock a baseline —
   * which permanently blocked design (FR-036). The layers the user typed in
   * MANUAL mode are a complete baseline on their own.
   */
  const manualRows = $derived(
    rows
      .filter((r) => r.technology.trim().length > 0)
      .map((r) => ({
        category: r.category,
        technology: r.technology.trim(),
        version_constraint: r.version.trim() || null,
        selection_source: "USER_SELECTED" as const,
        locked_by_user: true,
        rationale: r.why.trim() || "Chosen manually by the operator.",
        package: r.pkg,
        // For display only; locking re-checks every package on the server.
        verified: optionOf(r)?.verified ?? undefined,
      })),
  );
  const approvable = $derived<StackComponent[]>(
    chosen.length > 0 ? chosen : (manualRows as unknown as StackComponent[]),
  );
</script>

<svelte:head>
  <title>Technology stack — {data.project.name}</title>
</svelte:head>

{#snippet layerList(layers: StackComponent[], why = false)}
  <ul class="flex flex-col">
    {#each layers as layer (layer.category)}
      <li class="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-baseline gap-4 border-b border-line px-4 py-3 text-[14px] last:border-0 max-sm:grid-cols-1 max-sm:gap-0.5 sm:px-5">
        <span class="text-[13px] font-semibold text-base-content/80">{layer.category}</span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="font-medium">{layer.technology}</span>
          <!-- What the package registry said: latest release, or stale / deprecated. -->
          <VerifiedNote verified={liveVerified(layer)} versionConstraint={layer.version_constraint} pkg={layer.package ?? optionFor(layer)?.package ?? null} technology={layer.technology} />
          {#if why && layerWhy(layer)}<span class="text-[13px] leading-relaxed text-base-content/80">{layerWhy(layer)}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
{/snippet}

<main class="flex flex-col gap-6 pb-8">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
        {#if showLocked && data.approvedStack}
          Tech stack <span class="font-mono font-medium tracking-tighter">v{data.approvedStack.version}</span> — <span class="text-primary-ink">locked</span>
        {:else if data.approvedStack}
          Revise tech stack
        {:else if approvable.length}
          Tech stack — ready to lock
        {:else}
          Tech stack
        {/if}
      </h1>
      {#if !showLocked && data.approvedStack}
        <p class="flex flex-wrap items-center gap-x-2 text-[14px] text-base-content/80">
          <span><span class="font-mono">v{data.approvedStack.version}</span> stays locked until you lock a new one.</span>
          <button type="button" class="link font-medium text-base-content underline-offset-2" onclick={() => (revising = false)}>
            Keep v{data.approvedStack.version}
          </button>
        </p>
      {:else if !showLocked}
        <p class="text-[14px] text-base-content/80">Take a recommendation or set each layer.</p>
      {/if}
    </div>

    {#if !showLocked}
      <div class="join max-sm:grid max-sm:w-full max-sm:grid-cols-2" role="group" aria-label="How to choose the stack">
        <button
          type="button"
          class="btn btn-sm join-item max-sm:h-11 max-sm:px-2.5 max-sm:text-[13px] {mode === 'RECOMMENDED' ? 'btn-active' : 'font-normal text-base-content/80'}"
          onclick={() => (mode = "RECOMMENDED")}
          aria-pressed={mode === "RECOMMENDED"}
        >
          <Sparkles class="size-3.5" aria-hidden="true" />
          <span>AI recommendation</span>
        </button>
        <button
          type="button"
          class="btn btn-sm join-item max-sm:h-11 max-sm:px-2.5 max-sm:text-[13px] {mode === 'MANUAL' ? 'btn-active' : 'font-normal text-base-content/80'}"
          onclick={() => (mode = "MANUAL")}
          aria-pressed={mode === "MANUAL"}
        >
          <User class="size-3.5" aria-hidden="true" />
          <span>Set it myself</span>
        </button>
      </div>
    {/if}
  </header>

  {#if showLocked && data.approvedStack}
    {#if data.justLocked}
      <Notice tone="success">Stack locked — version {data.approvedStack.version}.</Notice>
    {/if}
    {@const locked = data.approvedStack}
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div class="flex min-w-0 flex-col gap-5">
        <section class="card min-w-0 overflow-hidden border border-line bg-base-100" aria-labelledby="locked-heading">
          <h2 id="locked-heading" class="flex items-center gap-2 border-b border-line px-5 py-4 text-[16px] font-bold">
            <Lock class="size-4 text-primary-ink" aria-hidden="true" />Layers
          </h2>
          {@render layerList(locked.layers, true)}
        </section>

        <!-- The decision itself: why this stack, and what was weighed against it. -->
        <section class="card flex min-w-0 flex-col gap-4 border border-line bg-base-100 p-5 sm:p-6" aria-labelledby="why-heading">
          <div class="flex flex-col gap-1">
            <h2 id="why-heading" class="text-[16px] font-bold">Why this stack</h2>
            <p class="text-[13px] text-base-content/80">
              {#if locked.mode === "MANUAL"}Set layer by layer, by hand.{:else}The AI recommendation{#if locked.candidate}: <span class="font-medium text-base-content">{locked.candidate}</span>{/if}.{/if}
            </p>
          </div>
          {#if locked.rationale || locked.fit}
            <div class="flex max-w-[72ch] flex-col gap-2 text-[14px] leading-relaxed text-base-content">
              {#if locked.rationale}<p>{locked.rationale}</p>{/if}
              {#if locked.fit && locked.fit !== locked.rationale}<p class="text-base-content/80">{locked.fit}</p>{/if}
            </div>
          {/if}
          {#if locked.tradeoffs.length}
            <div class="flex flex-col gap-2">
              <h3 class="text-[13px] font-semibold text-base-content/80">Trade-offs</h3>
              <dl class="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
                {#each locked.tradeoffs as t, i (i)}
                  <dt class="font-semibold text-base-content">{t.dimension}</dt>
                  <dd class="leading-relaxed text-base-content/80 max-sm:mb-1">{t.assessment}</dd>
                {/each}
              </dl>
            </div>
          {/if}
          {#if locked.conflicts.length}
            <div class="flex flex-col gap-2">
              <h3 class="flex items-center gap-1.5 text-[13px] font-semibold text-base-content/80">
                <TriangleAlert class="size-3.5 text-warn" aria-hidden="true" />Findings accepted when it was locked
              </h3>
              <ul class="flex flex-col gap-1.5 text-[13px] leading-relaxed text-base-content/80">
                {#each locked.conflicts as c, i (i)}
                  <li><span class="font-semibold text-base-content">{c.category}</span> · {c.finding}</li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if !locked.rationale && !locked.fit && !locked.tradeoffs.length && !locked.conflicts.length && !locked.layers.some((l) => layerWhy(l))}
            <p class="text-[13px] text-base-content/80">No reasoning was recorded with this version.</p>
          {/if}
        </section>
      </div>

      <aside class="flex flex-col gap-5 self-start">
        {#if nextElsewhere && data.journey}
          <!-- The way on, in the page body. Phones already carry it in the bottom bar. -->
          <div class="card border border-primary-ink bg-base-100 p-5 max-sm:hidden">
            <NextStepBar variant="panel" level={2} journey={data.journey} projectId={data.project.id} />
          </div>
        {/if}

        {#if builtOn.length}
          <section class="card flex flex-col gap-1 border border-line bg-base-100 p-5" aria-labelledby="built-on-heading">
            <h2 id="built-on-heading" class="text-[16px] font-bold">Built on this stack</h2>
            <p class="text-[13px] text-base-content/80">Revising it sends these back for a fresh look.</p>
            <ul class="-mx-2 mt-2 flex flex-col">
              {#each builtOn as m (m.id)}
                <li>
                  <a class="flex min-h-11 items-center gap-2 rounded-field px-2 text-[13px] hover:bg-base-200" href={m.href}>
                    <span class="min-w-0 grow">
                      <span class="block truncate font-semibold text-base-content">{m.label}</span>
                      <span class="block truncate text-xs {m.state === 'draft' ? 'text-warn' : 'text-base-content/75'}">{builtOnState(m)}</span>
                    </span>
                    <ChevronRight class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
                  </a>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <section class="card flex flex-col gap-4 border border-line bg-base-100 p-5" aria-label="Revise the stack">
          {#if locked.approvedAt}
            <p class="text-[13px] text-base-content/80">
              Locked <time datetime={locked.approvedAt}>{approvedFormat.format(new Date(locked.approvedAt))}</time>
            </p>
          {/if}
          {#if data.draftDecision}
            <p class="rounded-field border border-line bg-base-200 px-3.5 py-2 text-[13px] text-base-content/80">
              A newer recommendation is on record, not locked.
            </p>
          {/if}
          <button type="button" class="btn btn-outline w-full" onclick={() => (revising = true)}>
            {data.draftDecision ? "Continue revising" : "Revise stack"}
          </button>
          <p class="text-xs text-base-content/80">Revising creates v{nextVersion}; v{locked.version} stays in the history.</p>
        </section>
      </aside>
    </div>
  {:else}
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div class="flex min-w-0 flex-col gap-4">
        {#if !data.aiAvailable}
          <Notice tone="info">
            No AI connected, so recommendations are off. Set each layer yourself, or <a class="font-medium underline underline-offset-2" href="/settings/ai">connect AI</a>.
          </Notice>
        {/if}

        <form
          method="post"
          action="?/recommend"
          class="flex flex-col gap-4"
          use:enhance={({ submitter }) => {
            generating = true;
            const asked = submitter?.getAttribute("name") === "suggest" ? submitter.getAttribute("value") : null;
            suggesting = asked;
            return async ({ result, update }) => {
              generating = false;
              suggesting = null;
              // A per-layer suggestion fills that layer's field, so the rows stay
              // the one place the user edits.
              if (asked && result.type === "success") {
                const suggested = suggestedLayer(result.data?.decision as StackDecision | undefined, asked);
                const row = rows.find((r) => r.category === asked);
                if (row && suggested) fillFromLayer(row, suggested);
              }
              // No reset: Svelte 5 bindings follow a form reset, which wiped every
              // typed layer and lock whenever an AI answer came back.
              await update({ reset: false });
            };
          }}
        >
          <input type="hidden" name="mode" value={mode} />

          {#if mode === "RECOMMENDED" && !decision}
            <div class="card flex flex-col items-center gap-2 border border-line bg-base-100 px-6 py-10 text-center">
              <Sparkles class="size-7 text-primary-ink" aria-hidden="true" />
              <h2 class="text-[18px] font-bold">Get a stack recommendation</h2>
              <p class="max-w-[48ch] text-[14px] text-base-content/80">Weighed against your approved requirements. Nothing locks until you approve.</p>
            </div>
          {/if}

          {#if mode === "MANUAL"}
            <section class="card overflow-hidden border border-line bg-base-100" aria-labelledby="layers-title">
              <h2 id="layers-title" class="sr-only">Stack layers</h2>
              <div class="hidden grid-cols-[160px_minmax(0,1fr)_44px_56px] items-center gap-4 border-b border-line bg-base-200 px-5 py-2.5 text-xs font-medium text-base-content/80 sm:grid" aria-hidden="true">
                <span>Layer</span><span>Choice</span><span class="text-center">AI</span><span class="text-center">Keep</span>
              </div>
              {#each rows as row, i (row.category)}
                {@const inputId = `stack-layer-${i}`}
                {@const busyHere = suggesting === row.category}
                {@const options = optionsFor(row.category)}
                {@const option = optionOf(row)}
                <!-- Phones: label above, then the choice, AI and "Keep" on one line.
                     From `sm`: one row per layer, like a table. -->
                <div
                  class="grid grid-cols-[minmax(0,1fr)_44px_64px] items-start gap-x-1 gap-y-1.5 border-b border-line px-3.5 py-3 last:border-0 sm:grid-cols-[160px_minmax(0,1fr)_44px_56px] sm:gap-4 sm:px-5 {busyHere ? 'bg-sky-soft' : ''}"
                >
                  <div class="col-span-3 flex min-h-10 items-center gap-1 sm:col-span-1">
                    <label for={inputId} class="text-[13px] font-semibold">{row.category}</label>
                    {#if !row.core}
                      <button type="button" class="btn btn-ghost btn-xs btn-square text-base-content/75" aria-label={`Remove the ${row.category} layer`} title="Remove layer" onclick={() => rows.splice(i, 1)}>
                        <X class="size-3.5" aria-hidden="true" />
                      </button>
                    {/if}
                  </div>
                  <!-- What the form posts for this layer. -->
                  <input type="hidden" name="category" value={row.category} />
                  <input type="hidden" name="technology" value={row.technology} />
                  <input type="hidden" name="version" value={row.version} />
                  <input type="hidden" name="package" value={packageField(row.pkg)} />
                  <div class="flex min-w-0 flex-col gap-1.5">
                    {#if options.length}
                      <select id={inputId} class="select w-full min-w-0 text-[14px]" value={row.choice} onchange={(e) => choose(row, e.currentTarget.value)} aria-busy={busyHere}>
                        <option value="">Choose…</option>
                        {#each options as o (o.id)}
                          <option value={o.id}>
                            {o.name}{o.verified?.latest_version ? ` — ${checkedAs(o) ? `${checkedAs(o)} ` : ""}${o.verified.latest_version}` : ""}{o.verified?.status === "deprecated" ? " · deprecated" : o.verified?.status === "stale" ? " · no recent release" : ""}
                          </option>
                        {/each}
                        <option value="other">Other…</option>
                      </select>
                      {#if option}
                        <VerifiedNote verified={option.verified} pkg={option.package} technology={option.name} />
                        {#if option.note}<span class="text-xs text-base-content/75">{option.note}</span>{/if}
                      {/if}
                      {#if row.choice === "other"}
                        <!-- Not in the list: the user's own technology, its version and why. -->
                        <div class="grid gap-2 rounded-field border border-line bg-base-200/60 p-2.5 sm:grid-cols-[minmax(0,1fr)_120px]">
                          <label class="flex min-w-0 flex-col gap-1 text-xs font-medium text-base-content/80">
                            Technology
                            <input class="input input-sm w-full text-[14px]" type="text" maxlength="120" placeholder="e.g. Phoenix LiveView" bind:value={row.technology} />
                          </label>
                          <label class="flex min-w-0 flex-col gap-1 text-xs font-medium text-base-content/80">
                            Version
                            <input class="input input-sm w-full font-mono text-[13px]" type="text" maxlength="60" placeholder="e.g. ^1" bind:value={row.version} />
                          </label>
                          <label class="flex min-w-0 flex-col gap-1 text-xs font-medium text-base-content/80 sm:col-span-2">
                            Why this one <span class="font-normal">(optional)</span>
                            <input class="input input-sm w-full text-[14px]" type="text" maxlength="500" placeholder="The team already runs it in production" bind:value={row.why} />
                          </label>
                        </div>
                      {/if}
                    {:else}
                      <!-- The choices haven't arrived (or the registry list is unavailable): type the technology. -->
                      <input id={inputId} class="input w-full min-w-0 text-[14px]" type="text" placeholder="e.g. PostgreSQL" bind:value={row.technology} aria-busy={busyHere} />
                    {/if}
                  </div>
                  <button
                    class="btn btn-ghost btn-sm btn-square justify-self-center max-sm:size-11"
                    type="submit"
                    name="suggest"
                    value={row.category}
                    disabled={generating || !data.aiAvailable}
                    aria-busy={busyHere}
                    aria-label={busyHere ? `Suggesting a ${row.category} with AI` : `Suggest a ${row.category} with AI`}
                    title="Ask AI for this layer only"
                  >
                    {#if busyHere}
                      <span class="loading loading-spinner loading-xs text-sky" aria-hidden="true"></span>
                    {:else}
                      <Wand2 class="size-4" aria-hidden="true" />
                    {/if}
                  </button>
                  <label class="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-base-content/80 max-sm:min-h-11 max-sm:justify-center max-sm:gap-1.5 max-sm:text-xs sm:justify-center">
                    <input
                      type="checkbox"
                      name="locked"
                      value={String(i)}
                      class="checkbox checkbox-sm checkbox-primary"
                      bind:checked={row.locked}
                      aria-label={`Keep ${row.category} when asking again`}
                    />
                    <span class="sm:hidden" aria-hidden="true">Keep</span>
                  </label>
                </div>
              {/each}
              <!-- More layers when the product needs them (Realtime, Email, Payments, …) or one of your own. -->
              <div class="flex flex-wrap items-center gap-2 border-t border-line bg-base-200/40 px-3.5 py-2.5 sm:px-5">
                {#if customLayer === null}
                  <select
                    class="select select-sm w-auto"
                    aria-label="Add a layer"
                    value=""
                    onchange={(e) => {
                      const v = e.currentTarget.value;
                      e.currentTarget.value = "";
                      if (v === "__custom") customLayer = "";
                      else if (v) addLayer(v);
                    }}
                  >
                    <option value="">+ Add layer</option>
                    {#each extraLayers as layer (layer)}<option value={layer}>{layer}</option>{/each}
                    <option value="__custom">Custom layer…</option>
                  </select>
                {:else}
                  <label class="input input-sm w-56 max-sm:w-full">
                    <span class="sr-only">Layer name</span>
                    <input type="text" class="grow" maxlength="64" placeholder="e.g. Analytics" bind:value={customLayer} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLayer(customLayer ?? ""); } }} />
                  </label>
                  <button type="button" class="btn btn-sm btn-outline border-line-control" onclick={() => addLayer(customLayer ?? "")} disabled={!customLayer?.trim()}>Add</button>
                  <button type="button" class="btn btn-sm btn-ghost" onclick={() => (customLayer = null)}>Cancel</button>
                {/if}
                {#if catalog}
                  <span class="ms-auto text-xs text-base-content/75 max-sm:w-full">Latest releases checked live against npm, PyPI, crates.io and GitHub.</span>
                {/if}
              </div>
            </section>
          {/if}

          <div class="flex flex-wrap items-center gap-3">
            <button class="btn max-sm:w-full {approvable.length ? 'btn-outline max-sm:h-11' : 'btn-primary max-sm:btn-lg'}" type="submit" disabled={generating} aria-busy={generating && !suggesting}>
              {#if generating && !suggesting}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Sparkles class="size-4" aria-hidden="true" />{/if}
              {#if mode === "MANUAL"}
                {generating && !suggesting ? "Checking…" : "Check my choices"}
              {:else}
                {generating && !suggesting ? "Recommending…" : decision ? "Recommend again" : "Recommend a stack"}
              {/if}
            </button>
            <AiProgress active={generating} label={progressLabel} estimate="about a minute" />
          </div>
        </form>

        {#if form?.message}
          <Notice tone="error">{form.message}</Notice>
        {/if}

        {#if decision}
          <div class="flex flex-col gap-4" transition:fade={{ duration: 160 }}>
            {#if restored}
              <p class="text-[13px] text-base-content/80" role="status">Your last recommendation, not locked yet.</p>
            {/if}

            {#if chosen.length}
              <section class="card overflow-hidden border border-line bg-base-100" aria-labelledby="rec-title">
                <div class="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
                  <h2 id="rec-title" class="text-[16px] font-bold">{recommended?.name ?? "Your choices"}</h2>
                  {#if decision.mode === "RECOMMENDED" && decision.recommendation_index !== null}
                    <span class="badge badge-sm border-primary bg-primary text-primary-content">Recommended</span>
                  {/if}
                </div>
                {@render layerList(approvable)}
                {#if decision.mode === "RECOMMENDED" && decision.candidates.length > 1}
                  <details class="group border-t border-line bg-base-200">
                    <summary class="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
                      Compare options
                      <span class="font-mono text-xs font-normal text-base-content/75">{decision.candidates.length}</span>
                      <ChevronDown class="ml-auto size-4 text-base-content/80 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div class="grid gap-3 px-5 pb-5 md:grid-cols-2">
                      {#each decision.candidates as candidate, i}
                        <div class="card border bg-base-100 p-4 {decision.recommendation_index === i ? 'border-primary-ink' : 'border-line'}">
                          <div class="mb-2 flex items-center justify-between gap-2">
                            <h3 class="text-[14px] font-bold">{candidate.name}</h3>
                            {#if decision.recommendation_index === i}
                              <span class="badge badge-sm border-mint/40 bg-mint-soft text-mint">Recommended</span>
                            {/if}
                          </div>
                          <ul class="flex flex-col gap-1 text-[13px]">
                            {#each candidate.layers as layer}
                              <li class="flex justify-between gap-3">
                                <span class="text-base-content/80">{layer.category}</span>
                                <span class="flex items-center gap-1 text-right font-medium">
                                  {#if layer.verified?.status === "deprecated" || layer.verified?.status === "stale"}
                                    <TriangleAlert class="size-3 shrink-0 {layer.verified.status === 'deprecated' ? 'text-danger' : 'text-warn'}" aria-hidden="true" />
                                    <span class="sr-only">{layer.verified.status === "deprecated" ? "Deprecated:" : "No recent release:"}</span>
                                  {/if}
                                  {layer.technology}
                                </span>
                              </li>
                            {/each}
                          </ul>
                          {#if candidate.tradeoffs.length}
                            <ul class="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-xs text-base-content/80">
                              {#each candidate.tradeoffs.slice(0, 3) as tradeoff}
                                <li><span class="font-semibold text-base-content">{tradeoff.dimension}:</span> {tradeoff.assessment}</li>
                              {/each}
                            </ul>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </details>
                {/if}
              </section>
            {/if}

            {#if decision.conflicts.length}
              <section class="card flex flex-col gap-3 border border-line bg-base-100 px-5 py-4" aria-labelledby="compat-title">
                <h2 id="compat-title" class="flex items-center gap-2 text-[15px] font-semibold">
                  <TriangleAlert class="size-4 text-warn" aria-hidden="true" />Compatibility findings
                </h2>
                <ul class="flex flex-col gap-2 text-[13px]">
                  {#each decision.conflicts as conflict}
                    <li class="flex items-start gap-2">
                      <span class="badge badge-sm shrink-0 {conflict.severity === 'BLOCKING' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-warn/40 bg-warn-soft text-warn'}">{conflict.severity.toLowerCase()}</span>
                      <span><span class="font-semibold">{conflict.category}</span> <span class="text-base-content/80">— {conflict.finding}</span></span>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          </div>
        {/if}
      </div>

      <!-- The decision. Manual lock works without asking the AI at all (C17/C21):
           the layers typed in "Set it myself" are a complete baseline on their own. -->
      <aside class="flex min-w-0 flex-col gap-4">
        <section
          class="card flex flex-col gap-4 border bg-base-100 p-5 {approvable.length ? 'border-primary-ink' : 'border-line'}"
          aria-labelledby="lock-title"
        >
          <div class="flex flex-col gap-1">
            <h2 id="lock-title" class="flex items-center gap-2 text-[16px] font-bold">
              <Lock class="size-4 text-primary-ink" aria-hidden="true" />Lock <span class="font-mono font-medium">v{nextVersion}</span>
            </h2>
            <p class="text-[13px] text-base-content/80">
              {approvable.length ? `${approvable.length} ${approvable.length === 1 ? "layer" : "layers"}. ${lockNote}` : "Set or recommend a layer first."}
            </p>
          </div>
          {#if approvable.length}
            <div class="[&>.btn]:w-full max-sm:[&>.btn]:h-12">
              <DecisionReceipt
                kind="stack"
                version={nextVersion}
                replaces={data.approvedStack?.version ?? null}
                summary={`${approvable.length} components`}
                action="?/approve"
                fields={{ components: JSON.stringify(approvable.map((c) => ({ ...c, locked_by_user: chosen.length ? decision?.mode === "MANUAL" : true }))) }}
                label="Lock stack"
              />
            </div>
          {/if}
        </section>
      </aside>
    </div>
  {/if}
</main>
