<script lang="ts">
  import { ArrowRight, Check, ChevronDown, ChevronRight, CircleCheck, Layers, Minus, PenLine } from "lucide-svelte";
  import NextStepBar from "$lib/components/NextStepBar.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { featureStatusLabel } from "$lib/labels.js";
  import type { Journey, Milestone } from "$lib/journey.js";

  /**
   * The project notebook: the whole path from idea to release as one page of
   * chapters. The chapter the next action belongs to is open and carries that
   * action; done chapters are one line with where they stand; chapters to come
   * say what they will hold. The spine above links every chapter too, so
   * "back" is always either this page or the chapter before.
   */
  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; key: string; name: string; lifecycleStatus: string; highLevelIdea: string; constraints: string[] };
      features: Array<{ id: string; key: string; title: string; description: string; status: string; checked: boolean; can_complete: boolean; counts: { total: number; done: number } }>;
      journey: Journey;
    };
    form: { ok?: boolean; step?: string; message?: string } | null;
  } = $props();

  const journey = $derived(data.journey);
  const nextId = $derived(journey.finished ? null : (journey.milestones[journey.step - 1]?.id ?? null));
  const currentMilestone = $derived(journey.milestones[journey.step - 1]);
  let ideaOpen = $state(false);
  // The idea is read in two lines by default; the rest (and the constraints) on request.
  const ideaFolds = $derived(data.project.highLevelIdea.length > 180 || /\n/.test(data.project.highLevelIdea) || data.project.constraints.length > 0);
  // Where the open chapter stands, said once on the step's own line instead of in a second heading.
  const chapterNote = (m: Milestone) =>
    [m.optional ? "optional" : "", m.state !== "todo" && m.state !== "current" ? m.summary : ""].filter(Boolean).join(" · ");
  // The step's button usually opens the chapter itself; a separate link only when it goes elsewhere (or runs an action).
  const needsChapterLink = (m: Milestone) => journey.next.href !== m.href;

  const STATE_TEXT: Record<Milestone["state"], string> = {
    done: "Done",
    draft: "Draft waiting for approval",
    current: "Next up",
    todo: "Not started",
    skipped: "Skipped",
  };
  // What a chapter's link says: what you'd do there now.
  const openLabel = (m: Milestone) =>
    m.state === "draft" ? "Review draft" : m.state === "done" ? "Open" : m.state === "skipped" ? "Open anyway" : "Open";

  // A feature is "built" once all its tasks are done, even before the release check marks it complete.
  const featureState = (f: Data["features"][number]) =>
    f.status === "COMPLETE" || f.status === "CANCELLED"
      ? featureStatusLabel(f.status)
      : f.checked && f.can_complete
        ? "Ready to mark complete"
        : f.checked
          ? "Gaps to fix"
          : f.counts.total > 0 && f.counts.done === f.counts.total
            ? "Built — awaiting release check"
            : f.counts.done > 0
              ? "In progress"
              : featureStatusLabel(f.status);
  type Data = typeof data;
</script>

{#snippet glyph(m: Milestone)}
  <span
    class="relative inline-grid size-5.5 shrink-0 place-items-center rounded-full text-xs font-bold leading-none tabular-nums {m.state === 'done'
      ? 'bg-mint-soft text-mint'
      : m.state === 'draft'
        ? 'bg-warn-soft text-warn ring-1 ring-warn/40'
        : m.state === 'current'
          ? 'bg-primary text-primary-content ring-4 ring-primary-soft'
          : 'border border-line-control bg-base-200 text-base-content/75'}"
    aria-hidden="true"
  >
    {#if m.state === "done"}<Check class="size-3" strokeWidth={3} />{:else if m.state === "skipped"}<Minus class="size-3" />{:else if m.state === "draft"}<PenLine class="size-3" strokeWidth={2.5} />{:else}{m.n}{/if}
  </span>
{/snippet}

<main class="flex flex-col gap-7 sm:gap-8">
  {#if form?.message}
    <Notice tone="error">{form.message}</Notice>
  {/if}

  <!-- The idea the whole notebook is about -->
  <header class="flex flex-col gap-2 sm:gap-3">
    <h1 class="min-w-0 text-[28px] font-extrabold tracking-tight text-balance sm:text-[32px]">
      {#if journey.finished}{data.project.name} is <span class="text-primary-ink">complete</span>.
      {:else if currentMilestone}{data.project.name} is in {currentMilestone.label}.
      {:else}{data.project.name}{/if}
    </h1>
    {#if data.project.highLevelIdea}
      <div id="project-idea" class="flex max-w-[72ch] flex-col items-start gap-2">
        <p class="text-[14px] leading-relaxed whitespace-pre-line text-base-content/80 {ideaOpen ? '' : 'line-clamp-2'}">{data.project.highLevelIdea}</p>
        {#if ideaOpen && data.project.constraints.length}
          <ul class="flex flex-wrap gap-1.5" aria-label="Constraints">
            {#each data.project.constraints as constraint}<li class="badge badge-sm border-line text-xs">{constraint}</li>{/each}
          </ul>
        {/if}
        {#if ideaFolds}
          <button
            type="button"
            class="btn btn-ghost btn-xs -ms-2 gap-1 font-medium text-base-content/80 max-sm:h-9"
            aria-expanded={ideaOpen}
            aria-controls="project-idea"
            onclick={() => (ideaOpen = !ideaOpen)}
          >
            {ideaOpen ? "Show less" : data.project.constraints.length ? "The whole idea and its constraints" : "The whole idea"}<ChevronDown class="size-3.5 transition-transform {ideaOpen ? 'rotate-180' : ''}" aria-hidden="true" />
          </button>
        {/if}
      </div>
    {/if}
  </header>

  {#if journey.finished}
    <div class="card flex flex-wrap items-center gap-3 border border-mint/40 bg-base-100 p-4">
      <CircleCheck class="size-5 shrink-0 text-mint" aria-hidden="true" />
      <p class="min-w-0 flex-1 text-[14px] font-semibold text-base-content">{journey.next.title}</p>
      {#if journey.next.href}<a class="btn btn-sm btn-outline" href={journey.next.href}>{journey.next.cta}</a>{/if}
    </div>
  {/if}

  <div class="grid gap-8 {data.features.length ? 'lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-10' : 'max-w-[860px]'}">
    <!-- The chapters, in the order the work happens, on one thread -->
    <section class="relative min-w-0" aria-labelledby="chapters-title">
      <h2 id="chapters-title" class="sr-only">Chapters</h2>
      <span class="absolute start-[10px] top-5 bottom-5 w-0.5 rounded-full bg-line" aria-hidden="true"></span>
      <ol class="relative flex flex-col">
        {#each journey.milestones as m (m.id)}
          {#if m.id === nextId}
            <!-- The open chapter: what it holds, and the one thing to do now -->
            <li class="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5 py-1.5 sm:gap-4">
              <span class="mt-5">{@render glyph(m)}</span>
              <!-- One title, one sentence, one action: the chapter line carries where it stands, no card inside the card. -->
              <section class="card flex min-w-0 flex-col gap-3 border border-primary-ink bg-base-100 p-4.5 sm:p-5 sm:px-6" aria-label={`${m.label} — ${STATE_TEXT[m.state]}`}>
                <NextStepBar variant="panel" level={3} note={chapterNote(m)} journey={data.journey} projectId={data.project.id} />
                {#if needsChapterLink(m)}
                  <a class="link self-start text-[13px] font-medium text-base-content/80 underline-offset-2 hover:text-base-content" href={m.href}>Open {m.label}</a>
                {/if}
              </section>
            </li>
          {:else if m.state === "todo"}
            <li class="grid min-h-11 grid-cols-[22px_minmax(0,1fr)] items-center gap-3.5 sm:gap-4" title={m.blurb}>
              {@render glyph(m)}
              <p class="min-w-0 truncate text-[14px]">
                <span class="font-semibold text-base-content/80">{m.label}</span>{#if m.optional}<span class="text-[13px] text-base-content/75">{" · optional"}</span>{/if}
                <span class="sr-only">— {STATE_TEXT[m.state]}</span>
              </p>
            </li>
          {:else}
            <li>
              <a
                class="group grid min-h-11 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-field sm:gap-4"
                href={m.href}
                aria-label={`${m.label} — ${STATE_TEXT[m.state]}: ${openLabel(m)}`}
              >
                {@render glyph(m)}
                <span class="flex min-w-0 items-baseline gap-1.5 text-[14px]">
                  <span class="shrink-0 font-semibold group-hover:underline group-hover:underline-offset-3 {m.state === 'skipped' ? 'text-base-content/80' : 'text-base-content'}">{m.label}</span>
                  {#if m.state === "draft"}
                    <span class="truncate text-[13px] font-medium text-warn">· {m.summary || "Review draft"}</span>
                  {:else if m.state === "skipped"}
                    <span class="truncate text-[13px] text-base-content/75">· Skipped</span>
                  {:else if m.summary}
                    <span class="truncate text-[13px] text-base-content/75">· {m.summary}</span>
                  {/if}
                </span>
                <ChevronRight class="size-3.5 text-base-content/75" aria-hidden="true" />
              </a>
            </li>
          {/if}
        {/each}
      </ol>
    </section>

    {#if data.features.length}
      <!-- What the approved specs break into, each traced to its tasks -->
      <aside class="flex min-w-0 flex-col gap-3" aria-labelledby="features-title">
        <h2 id="features-title" class="text-[16px] font-semibold">Features</h2>
        <ul class="card border border-line bg-base-100 px-4.5 py-1">
          {#each data.features as feature (feature.id)}
            {@const allDone = feature.counts.total > 0 && feature.counts.done === feature.counts.total}
            <li class="flex flex-col gap-2 border-b border-line py-3.5 last:border-b-0" title={feature.description || undefined}>
              <div class="flex items-center gap-2">
                <Layers class="size-3.5 shrink-0 text-violet" aria-hidden="true" />
                <h3 class="min-w-0 flex-1 text-[14px] font-semibold text-base-content">{feature.title}</h3>
                {#if feature.counts.total > 0}
                  <span class="shrink-0 text-xs font-semibold tabular-nums {allDone ? 'text-mint' : 'text-base-content/80'}">
                    {feature.counts.done}/{feature.counts.total}<span class="sr-only"> tasks done</span>
                  </span>
                {/if}
              </div>
              {#if feature.counts.total > 0}
                {#if feature.counts.total <= 24}
                  <div class="grid gap-[3px]" style={`grid-template-columns: repeat(${feature.counts.total}, minmax(0, 1fr));`} aria-hidden="true">
                    {#each Array.from({ length: feature.counts.total }, (_, i) => i) as i (i)}
                      <span class="block h-1.25 rounded-full {i < feature.counts.done ? 'bg-mint' : 'bg-base-300'}"></span>
                    {/each}
                  </div>
                {:else}
                  <div class="h-1.25 overflow-hidden rounded-full bg-base-300" aria-hidden="true">
                    <span class="block h-full origin-left rounded-full bg-mint" style={`transform: scaleX(${feature.counts.done / feature.counts.total})`}></span>
                  </div>
                {/if}
              {/if}
              <p class="text-xs text-base-content/75">{featureState(feature)}</p>
            </li>
          {/each}
        </ul>
      </aside>
    {/if}
  </div>
</main>
