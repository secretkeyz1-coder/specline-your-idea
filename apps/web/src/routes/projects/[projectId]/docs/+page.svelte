<script lang="ts">
  import { enhance } from "$app/forms";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import {
    Check,
    FileText,
    Layers,
    Network,
    Sparkles,
    History,
    Send,
    Search,
    BookOpen,
    Lock,
    Palette,
    ChevronDown,
    PanelsTopLeft,
  } from "lucide-svelte";
  import Dropdown from "$lib/components/ui/Dropdown.svelte";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import DecisionReceipt from "$lib/components/DecisionReceipt.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import ChapterNextStep from "$lib/components/ChapterNextStep.svelte";
  import type { Journey } from "$lib/journey.js";
  import { framedMockup } from "$lib/ux.js";
  import type { DesignSystemState } from "$lib/types.js";
  import type { SectionChanges, SectionRef } from "$lib/markdown.js";

  // Fixed locale + zone: identical on the server and after hydration.
  const revisionTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  let {
    data,
    form,
  }: {
    data: {
      designIssues: string[];
      tab: "requirements" | "stack" | "design" | "system";
      /** From the project layout: the one next step. */
      journey?: Journey;
      justLocked: boolean;
      fromDiscovery: boolean;
      saved: boolean;
      html: { requirements: string; doc: string };
      /** A draft's changes against the version in use (else the previous one); base null = first version. */
      changes: { base: number | null; items: SectionChanges } | null;
      ai: { requirements: boolean; design: boolean };
      designSystem: DesignSystemState;
      dsPreview: string;
      requirements: {
        revision: {
          id: string;
          version: number;
          status: string;
          content: string;
          approvedAt: string | null;
        } | null;
        approved_revision?: { version: number } | null;
        requirements: Array<{
          key: string;
          title: string;
          statement: string;
          priority: string;
          type: string;
          acceptance_criteria: Array<{ key: string; statement: string }>;
        }>;
      };
      stack: {
        artifact: { id: string; approvedRevisionId: string | null } | null;
        revisions: Array<{
          id: string;
          version: number;
          status: string;
          content: string;
          createdAt: string;
        }>;
      };
      design: {
        artifact: { id: string; approvedRevisionId: string | null } | null;
        revisions: Array<{
          id: string;
          version: number;
          status: string;
          content: string;
          createdAt: string;
        }>;
      };
      routing: {
        effective: Array<{
          role: string;
          configured: boolean;
          source?: string;
          model_id?: string;
          provider_type?: string;
        }>;
      };
    };
    form: { ok?: boolean; notice?: string; message?: string; issues?: string[] } | null;
  } = $props();

  let busy = $state<string | null>(null);
  // The refine form sits behind "Refine with AI" in the document's toolbar.
  let refineOpen = $state(false);
  let switcherOpen = $state(false);
  let instructions = $state("");
  let acSearch = $state("");
  // The requirements document is folded per requirement (foldRequirementSections).
  let docEl = $state<HTMLElement | null>(null);
  function setAllFolds(open: boolean) {
    docEl?.querySelectorAll<HTMLDetailsElement>("details.doc-fold").forEach((d) => (d.open = open));
  }
  // A link to "…?tab=requirements#req-FR-001" (e.g. from the technical design) opens that requirement's fold.
  afterNavigate(() => {
    const key = /^#req-([A-Z0-9-]+)$/.exec(page.url.hash)?.[1];
    if (key && data.tab === "requirements") setTimeout(() => openRequirement(key), 0);
  });
  function openRequirement(key: string) {
    const fold = document.getElementById(`req-${key}`) as HTMLDetailsElement | null;
    if (!fold) return;
    fold.open = true;
    fold.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    fold.querySelector("summary")?.focus({ preventScroll: true });
  }

  const tabs = [
    { id: "requirements" as const, label: "Requirements", icon: FileText },
    { id: "stack" as const, label: "Tech stack", icon: Layers },
    { id: "design" as const, label: "Technical design", icon: Network },
    { id: "system" as const, label: "Design system", icon: Palette },
  ];
  const pid = $derived(page.params.projectId);
  // The five documents. Stack and UI reference live on their own pages
  // (the server redirects ?tab=stack and ?tab=ux there), so link them directly.
  const documents = $derived([
    { id: "requirements", label: "Requirements", icon: FileText, href: `/projects/${pid}/docs?tab=requirements` },
    { id: "stack", label: "Tech stack", icon: Layers, href: `/projects/${pid}/stack` },
    { id: "design", label: "Technical design", icon: Network, href: `/projects/${pid}/docs?tab=design` },
    { id: "system", label: "Design system", icon: Palette, href: `/projects/${pid}/docs?tab=system` },
    { id: "ux", label: "UI reference", icon: PanelsTopLeft, href: `/projects/${pid}/ux` },
  ]);
  // The document this chapter shows, and its version.
  const heading = $derived(tabs.find((t) => t.id === data.tab) ?? tabs[0]!);
  const headingVersion = $derived(
    data.tab === "requirements"
      ? data.requirements.revision?.version
      : data.tab === "stack"
        ? data.stack.revisions[0]?.version
        : data.tab === "design"
          ? data.design.revisions[0]?.version
          : (data.designSystem.draft?.version ?? data.designSystem.approved?.version),
  );

  const latestRevision = $derived(
    data.tab === "stack" ? (data.stack.revisions[0] ?? null) : data.tab === "design" ? (data.design.revisions[0] ?? null) : null,
  );
  const tabRevisions = $derived(data.tab === "stack" ? data.stack.revisions : data.design.revisions);
  const stackApproved = $derived(data.stack.revisions.find((r) => r.status === "APPROVED") ?? null);
  const designApproved = $derived(data.design.revisions.find((r) => r.status === "APPROVED") ?? null);

  // One status word in the headline, one supporting line under it.
  const headingStatus = $derived.by((): string | null => {
    if (data.tab === "requirements") {
      const r = data.requirements.revision;
      return !r ? null : r.status === "DRAFT" ? "ready to approve" : "approved";
    }
    if (data.tab === "stack") return stackApproved ? "locked" : latestRevision ? "not locked" : null;
    if (data.tab === "design") return latestRevision?.status === "DRAFT" ? (data.designIssues.length ? "needs changes" : "ready to approve") : designApproved ? "approved" : null;
    return data.designSystem.draft ? "draft" : data.designSystem.approved ? "in use" : null;
  });
  const inUseVersion = $derived.by((): number | null => {
    if (data.tab === "requirements") {
      const r = data.requirements.revision;
      const v = data.requirements.approved_revision?.version ?? null;
      return r?.status === "DRAFT" && v !== null && v !== r.version ? v : null;
    }
    if (data.tab === "design") return latestRevision?.status === "DRAFT" && designApproved ? designApproved.version : null;
    if (data.tab === "system") return data.designSystem.draft && data.designSystem.approved ? data.designSystem.approved.version : null;
    return null;
  });

  // One line for the decision receipt: what this draft changes.
  const changeLine = $derived.by(() => {
    const c = data.changes;
    if (!c || c.base === null) return "";
    const parts = [
      c.items.added.length && `${c.items.added.length} added`,
      c.items.changed.length && `${c.items.changed.length} changed`,
      c.items.removed.length && `${c.items.removed.length} removed`,
    ].filter(Boolean);
    return parts.length ? `since v${c.base}: ${parts.join(", ")}` : `no text changes since v${c.base}`;
  });

  const dsView = $derived(data.designSystem.draft?.spec ?? data.designSystem.approved?.spec ?? null);
  // UI reference (its tab opens the canvas): the draft being worked on wins over the approved version.

  const filteredRequirements = $derived.by(() => {
    if (!acSearch.trim()) return data.requirements.requirements;
    const q = acSearch.toLowerCase().trim();
    return data.requirements.requirements.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.acceptance_criteria.some(
          (ac) =>
            ac.key.toLowerCase().includes(q) ||
            ac.statement.toLowerCase().includes(q),
        ),
    );
  });
</script>

{#snippet history()}
  <details class="collapse collapse-arrow rounded-box border border-line bg-base-100">
    <summary class="collapse-title flex min-h-12 items-center gap-2 py-3 text-[13px] font-semibold">
      <History class="size-4 text-base-content/80" aria-hidden="true" />
      <span>History</span>
      <span class="font-mono text-xs font-normal text-base-content/75">{tabRevisions.length}</span>
    </summary>
    <ul class="collapse-content flex flex-col divide-y divide-line text-xs">
      {#each tabRevisions as revision (revision.id)}
        <li class="flex items-center justify-between gap-2 py-2">
          <span class="flex items-center gap-2">
            <span class="font-mono font-medium tracking-tight text-base-content">v{revision.version}</span>
            <span class={revision.status === "APPROVED" ? "text-mint" : "text-base-content/80"}>{revision.status.toLowerCase()}</span>
          </span>
          <time class="tabular-nums text-base-content/80" datetime={revision.createdAt}>{revisionTime.format(new Date(revision.createdAt))} UTC</time>
        </li>
      {/each}
    </ul>
  </details>
{/snippet}

{#snippet emptyState(Icon: typeof FileText, title: string, line: string)}
  <Icon class="size-8 text-primary-ink" aria-hidden="true" />
  <h2 class="text-[18px] font-bold tracking-tight">{title}</h2>
  <p class="max-w-[52ch] text-[14px] text-base-content/80">{line}</p>
{/snippet}

<!-- What the draft changes, inside its approval card: counts at a glance, the sections on request. -->
{#snippet changesSummary()}
  {#if data.changes}
    {@const c = data.changes.items}
    {@const total = c.added.length + c.changed.length + c.removed.length}
    <div class="border-t border-line pt-3 text-[13px]">
      {#if data.changes.base === null}
        <p class="text-base-content/80">First version, so there is nothing to compare it with.</p>
      {:else if total === 0}
        <p class="text-base-content/80">Same text as <span class="font-mono">v{data.changes.base}</span>.</p>
      {:else}
        <details class="group/changes">
          <summary class="flex min-h-9 cursor-pointer list-none items-start gap-2 py-0.5 [&::-webkit-details-marker]:hidden">
            <ChevronDown class="mt-[3px] size-3.5 shrink-0 -rotate-90 text-base-content/80 transition-transform group-open/changes:rotate-0" aria-hidden="true" />
            <span class="flex flex-col">
              <span class="font-semibold">Changes since <span class="font-mono font-medium">v{data.changes.base}</span></span>
              <span class="text-xs text-base-content/80 tabular-nums">
                {[c.added.length && `${c.added.length} added`, c.changed.length && `${c.changed.length} changed`, c.removed.length && `${c.removed.length} removed`].filter(Boolean).join(" · ")}
              </span>
            </span>
          </summary>
          <div class="mt-1 flex max-h-72 flex-col gap-3 overflow-y-auto ps-5.5">
            {@render changeGroup("Added", c.added, true)}
            {@render changeGroup("Changed", c.changed, true)}
            {@render changeGroup("Removed", c.removed, false)}
          </div>
        </details>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet changeGroup(label: string, refs: SectionRef[], inDraft: boolean)}
  {#if refs.length}
    <div class="flex flex-col gap-1">
      <h3 class="text-xs font-semibold text-base-content/80">{label} <span class="font-mono font-normal tabular-nums">{refs.length}</span></h3>
      <ul class="flex flex-col">
        {#each refs as ref, i (`${ref.key ?? ref.title}-${i}`)}
          <li>
            {#if ref.key && inDraft && data.tab === "requirements"}
              <!-- In the draft: opens the requirement in the document. -->
              <button type="button" class="flex min-h-8 w-full items-baseline gap-2 rounded-field px-1.5 py-1 text-left hover:bg-base-200" onclick={() => openRequirement(ref.key!)}>
                <span class="shrink-0 font-mono text-xs text-base-content/80">{ref.key}</span>
                <span class="min-w-0 truncate text-base-content">{ref.title}</span>
              </button>
            {:else}
              <span class="flex min-h-8 items-baseline gap-2 px-1.5 py-1 {inDraft ? '' : 'text-base-content/80'}">
                {#if ref.key}<span class="shrink-0 font-mono text-xs text-base-content/80">{ref.key}</span>{/if}
                <span class="min-w-0 truncate {inDraft ? 'text-base-content' : 'line-through decoration-base-content/40'}">{ref.title}</span>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<main class="flex flex-col gap-5">
  {#if form?.notice}
    <Notice tone="success">{form.notice}</Notice>
  {:else if form?.message}
    <Notice tone="error">{form.message}{#if form.issues?.length}<ul class="mt-2 list-disc pl-5">{#each form.issues as issue}<li>{issue}</li>{/each}</ul>{/if}</Notice>
  {/if}

  {#if data.saved && !form && (data.tab === "requirements" || data.tab === "design")}
    <Notice tone="success">Draft saved. Review it and resolve any approval issues.</Notice>
  {/if}
  {#if data.fromDiscovery && data.tab === "requirements" && !data.requirements.revision && !form}
    <Notice tone="success">Discovery complete. Next, turn it into numbered requirements.</Notice>
  {/if}
  {#if data.justLocked && stackApproved && data.tab === "stack"}
    <Notice tone="success">Stack locked — version {stackApproved.version}.</Notice>
  {/if}

  <!-- Header: the document, its version and state; the switcher reaches the other four. -->
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
        {heading.label}
        {#if headingVersion}<span class="font-mono font-medium tracking-tighter">v{headingVersion}</span>{/if}
        {#if headingStatus}— <span class={headingStatus === "approved" || headingStatus === "locked" ? "text-primary-ink" : ""}>{headingStatus}</span>{/if}
      </h1>
      {#if inUseVersion !== null}
        <p class="text-[14px] text-base-content/80"><span class="font-mono">v{inUseVersion}</span> stays in use until you approve.</p>
      {/if}
    </div>

    <Dropdown bind:open={switcherOpen} align="end" class="w-60 rounded-box border border-line bg-base-100 p-1.5 shadow-xl">
      {#snippet trigger(props)}
        <button type="button" {...props} class="btn btn-ghost btn-sm gap-1.5 font-medium" aria-label="Switch document">
          <heading.icon class="size-4 text-base-content/80" aria-hidden="true" />
          <span>Documents</span>
          <ChevronDown class="size-3.5 text-base-content/80" aria-hidden="true" />
        </button>
      {/snippet}
      <nav aria-label="Documents">
        <ul class="menu w-full p-0">
          {#each documents as d (d.id)}
            <li>
              <a href={d.href} class="min-h-10 text-[13px] {d.id === data.tab ? 'menu-active font-semibold' : ''}" aria-current={d.id === data.tab ? "page" : undefined} onclick={() => (switcherOpen = false)}>
                <d.icon class="size-4" aria-hidden="true" />{d.label}
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    </Dropdown>
  </header>

  {#if data.tab === "requirements"}
    {#if data.requirements.revision}
      {@const revision = data.requirements.revision}
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:gap-x-8">
        {#if revision.status === "DRAFT"}
          <!-- The decision. Phones read the document first and decide at its end; tablets see it first; from lg it sits at the top of the side column. -->
          <section class="card flex flex-col gap-4 border border-primary-ink bg-base-100 p-5 lg:col-start-2 lg:row-start-1" aria-labelledby="approve-title">
            <div class="flex flex-col gap-1">
              <h2 id="approve-title" class="text-[16px] font-bold">Approve <span class="font-mono font-medium">v{revision.version}</span>?</h2>
              <p class="text-[13px] text-base-content/80">
                {data.requirements.requirements.length} requirements, {data.requirements.requirements.filter((r) => r.priority === "P0").length} P0{#if data.requirements.approved_revision && data.requirements.approved_revision.version !== revision.version}. Replaces <span class="font-mono">v{data.requirements.approved_revision.version}</span>{/if}.
              </p>
            </div>
            {@render changesSummary()}
            <div class="[&>.btn]:w-full max-sm:[&>.btn]:h-12">
              <DecisionReceipt
                kind="requirements"
                version={revision.version}
                replaces={data.requirements.approved_revision?.version ?? null}
                summary={`${data.requirements.requirements.length} requirements, ${data.requirements.requirements.filter((r) => r.priority === "P0").length} P0${changeLine ? `; ${changeLine}` : ""}`}
                action="?/approveRevision"
                fields={{ revisionId: revision.id, artifactType: "requirements" }}
                label={`Approve v${revision.version}`}
              />
            </div>
          </section>
        {/if}

        <!-- The document -->
        <article class="card min-w-0 border border-line bg-base-100 max-sm:order-first lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div class="flex flex-wrap items-center justify-end gap-2 border-b border-line px-4 py-2.5">
            <div class="mr-auto flex items-center">
              <button type="button" class="btn btn-ghost btn-sm text-xs font-normal text-base-content/80" onclick={() => setAllFolds(true)}>Expand all</button>
              <button type="button" class="btn btn-ghost btn-sm text-xs font-normal text-base-content/80" onclick={() => setAllFolds(false)}>Collapse all</button>
            </div>
            {#if revision.status === "DRAFT"}
              <button type="button" class="btn btn-ghost btn-sm" aria-expanded={refineOpen} aria-controls="refine-panel" onclick={() => (refineOpen = !refineOpen)}>
                <Sparkles class="size-4" aria-hidden="true" />Refine with AI
              </button>
              <a class="btn btn-outline btn-sm" href={`/projects/${pid}/docs/requirements/edit`}>Edit draft</a>
            {:else}
              <!-- Approved is not final: a new version can be started from it. -->
              <a class="btn btn-outline btn-sm" href={`/projects/${pid}/docs/requirements/edit`}>Start new version</a>
            {/if}
          </div>
          {#if revision.status === "DRAFT"}
            <div id="refine-panel" class="border-b border-line bg-base-200 px-4 py-3" hidden={!refineOpen && busy !== "refine"}>
              <form
                method="post"
                action="?/refineRequirements"
                use:enhance={() => {
                  busy = "refine";
                  return async ({ result, update }) => {
                    busy = null;
                    // Keep the instructions when refinement failed, so they can be retried.
                    if (result.type === "success") instructions = "";
                    await update({ reset: result.type === "success" });
                  };
                }}
                class="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <input
                  class="input input-sm w-full text-[13px] sm:flex-1"
                  type="text"
                  name="instructions"
                  aria-label="How should the AI change this draft?"
                  placeholder="e.g. add offline acceptance criteria"
                  bind:value={instructions}
                  required
                  minlength={3}
                />
                <button class="btn btn-outline btn-sm" type="submit" disabled={busy !== null}>
                  {#if busy === "refine"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Send class="size-3.5" aria-hidden="true" />{/if}
                  <span>{busy === "refine" ? "Refining…" : "Refine draft"}</span>
                </button>
              </form>
              <!-- Refining rewrites the draft with AI: say so while it runs. -->
              <AiProgress active={busy === "refine"} label="Refining the requirements" estimate="about a minute" class="mt-2" />
            </div>
          {/if}
          <div class="prose-doc max-w-none px-4 py-5 sm:px-10 sm:py-8" bind:this={docEl}>
            {@html data.html.requirements}
          </div>
        </article>

        <!-- The index: finds a requirement (and, while searching, its criteria). -->
        <aside class="flex min-w-0 flex-col gap-3 lg:col-start-2 {revision.status === 'DRAFT' ? 'lg:row-start-2' : 'lg:row-span-2 lg:row-start-1'}" aria-labelledby="index-title">
          {#if revision.status === "APPROVED"}<ChapterNextStep journey={data.journey} projectId={pid} chapter="requirements" />{/if}
          <div class="card sticky top-[70px] border border-line bg-base-100 p-4">
            <h2 id="index-title" class="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <BookOpen class="size-4 text-base-content/80" aria-hidden="true" />
              Index
              <span class="font-mono text-xs font-normal text-base-content/75">{data.requirements.requirements.length}</span>
            </h2>
            <label class="input input-sm mb-3 w-full text-[13px]">
              <Search class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
              <input bind:value={acSearch} type="search" aria-label="Search criteria" placeholder="Search requirements" class="grow" />
            </label>

            <!-- A scrolling region must be reachable by keyboard (axe: scrollable-region-focusable),
                 which Svelte's tabindex rule does not know about. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <ul class="-mx-1 flex max-h-[520px] flex-col overflow-y-auto px-1" aria-label="Requirements and their criteria" tabindex="0">
              {#each filteredRequirements as requirement (requirement.key)}
                <li class="border-b border-line last:border-0">
                  <!-- The document has the full text; the index finds it: open and scroll to the requirement. -->
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-2.5 rounded-field px-2 py-2 text-left hover:bg-base-200"
                    onclick={() => openRequirement(requirement.key)}
                  >
                    <span class="shrink-0 font-mono text-xs text-base-content/80">{requirement.key}</span>
                    <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{requirement.title && requirement.title !== requirement.key ? requirement.title : ""}</span>
                    <span class="badge badge-sm shrink-0 font-mono {requirement.priority === 'P0' ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line bg-base-200 text-base-content/80'}">{requirement.priority}</span>
                  </button>
                  {#if acSearch.trim()}
                    <!-- While searching, the matching criteria show here too. -->
                    <ul class="flex flex-col gap-1.5 px-2 pb-2">
                      {#each requirement.acceptance_criteria.filter((ac) => `${ac.key} ${ac.statement}`.toLowerCase().includes(acSearch.toLowerCase().trim())) as ac (ac.key)}
                        <li class="flex items-start gap-1.5 text-xs text-base-content/80">
                          <span class="shrink-0 font-mono font-medium text-sky">{ac.key}</span>
                          <span class="leading-snug">{ac.statement}</span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}

              {#if filteredRequirements.length === 0}
                <li class="py-4 text-center text-xs text-base-content/80">No match for "{acSearch}"</li>
              {/if}
            </ul>
          </div>
        </aside>
      </div>
    {:else}
      <div class="card flex flex-col items-center gap-3 border border-line bg-base-100 px-6 py-12 text-center">
        {@render emptyState(FileText, "No requirements yet", data.ai.requirements ? "Generate a draft from discovery, or write it yourself." : "No AI is connected for requirements. Write them yourself.")}
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          {#if data.ai.requirements}
            <form
              method="post"
              action="?/generateRequirements"
              use:enhance={() => {
                busy = "gen";
                return async ({ update }) => {
                  busy = null;
                  await update();
                };
              }}
            >
              <button class="btn btn-primary" type="submit" disabled={busy !== null} aria-busy={busy === "gen"}>
                {#if busy === "gen"}
                  <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Writing requirements… about a minute
                {:else}
                  <Sparkles class="size-4" aria-hidden="true" />Generate requirements
                {/if}
              </button>
            </form>
          {/if}
          <a class={data.ai.requirements ? "btn btn-outline" : "btn btn-primary"} href={`/projects/${pid}/docs/requirements/edit`}>
            Write them yourself
          </a>
          {#if !data.ai.requirements}
            <a class="btn btn-ghost" href="/settings/ai">Connect AI</a>
          {/if}
        </div>
      </div>
    {/if}
  {:else if data.tab === "system"}
    <!-- Design system: what is in use and how it looks; the workspace does the editing. -->
    {#if data.designSystem.stale}
      <Notice tone="warn">
        The stack changed after this was approved.
        <a class="font-medium underline underline-offset-2" href={`/projects/${pid}/design-system`}>Review it</a>.
      </Notice>
    {/if}
    {#if !dsView}
      <div class="card flex flex-col items-center gap-3 border border-line bg-base-100 px-6 py-12 text-center">
        {@render emptyState(Palette, "No design system yet", "Optional. The agent follows it on every screen.")}
        {#if data.designSystem.stack_approved}
          <a class="btn btn-primary mt-2" href={`/projects/${pid}/design-system`}>Choose design system</a>
        {:else}
          <p class="flex items-center gap-1.5 text-[13px] text-base-content/80"><Lock class="size-3.5" aria-hidden="true" />Lock the tech stack first.</p>
          <a class="btn btn-outline mt-1" href={`/projects/${pid}/stack`}>Open stack</a>
        {/if}
      </div>
    {:else}
      <div class="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">
        <section class="card flex flex-col gap-4 self-start border border-line bg-base-100 p-5 text-[13px]" aria-labelledby="ds-name">
          <div class="flex flex-col gap-1">
            <h2 id="ds-name" class="text-[16px] font-bold">{dsView.name}</h2>
            <p class="text-base-content/80">{dsView.summary}</p>
          </div>
          <span class="flex overflow-hidden rounded-field border border-line" aria-hidden="true">
            {#each ["bg", "surface2", "fgMuted", "accent", "fg"] as const as k (k)}
              <span class="h-6 flex-1" style="background: {dsView.light[k]}"></span>
            {/each}
          </span>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt class="text-base-content/80">Library</dt><dd class="font-medium">{(data.designSystem.draft ?? data.designSystem.approved)?.library_name ?? dsView.component_library}</dd>
            <dt class="text-base-content/80">Fonts</dt><dd>{dsView.fonts.display.split(",")[0]?.replace(/"/g, "")} / {dsView.fonts.body.split(",")[0]?.replace(/"/g, "")}</dd>
            <dt class="text-base-content/80">Shape</dt><dd>{dsView.radius}px radius · {dsView.depth}</dd>
            <dt class="text-base-content/80">Files</dt><dd><code class="font-mono text-xs">docs/design-system/</code></dd>
          </dl>
          <a class="btn btn-primary" href={`/projects/${pid}/design-system`}>
            {data.designSystem.draft ? "Continue editing" : "Open design system"}
          </a>
        </section>
        <div class="min-w-0 overflow-hidden rounded-box bg-base-300 p-3">
          {#if data.dsPreview}
            <iframe title="Preview of {dsView.name}" sandbox="" srcdoc={framedMockup(data.dsPreview)} class="block h-[640px] w-full rounded-field border border-line bg-white"></iframe>
          {:else}
            <p class="flex h-[240px] items-center justify-center text-[13px] text-base-content/80">The preview could not be drawn.</p>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <!-- Stack / Technical design -->
    {#if latestRevision}
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8">
        <article class="card min-w-0 border border-line bg-base-100">
          {#if data.tab === "design"}
            <div class="flex flex-wrap items-center justify-end gap-2 border-b border-line px-4 py-2.5">
              <a class="btn btn-outline btn-sm" href={`/projects/${pid}/docs/design/edit`}>
                {latestRevision.status === "DRAFT" ? "Edit draft" : "Start new version"}
              </a>
            </div>
          {/if}
          <div class="prose-doc max-w-none px-4 py-5 sm:px-10 sm:py-8">
            {@html data.html.doc}
          </div>
        </article>

        <!-- Phones: the document, then the decision, then history (collapsed). Tablets: the decision comes before the document. -->
        <aside class="flex min-w-0 flex-col gap-4 max-lg:contents">
          {#if data.tab === "stack" && latestRevision.status === "DRAFT" && !data.stack.artifact?.approvedRevisionId}
            <!-- A stack baseline is its normalized components (FR-036); it is locked
                 from the stack screen, never by approving a raw recommendation. -->
            <section class="card flex flex-col gap-3 border border-primary-ink bg-base-100 p-5 sm:max-lg:order-first">
              <h2 class="text-[16px] font-bold">Lock <span class="font-mono font-medium">v{latestRevision.version}</span>?</h2>
              <a class="btn btn-primary w-full max-sm:h-12" href={`/projects/${pid}/stack`}>
                <Check class="size-4" aria-hidden="true" />Review &amp; lock stack
              </a>
            </section>
          {:else if data.tab === "stack" && stackApproved}
            <ChapterNextStep journey={data.journey} projectId={pid} chapter="stack" class="sm:max-lg:order-first" />
            <a class="btn btn-outline self-start max-sm:w-full sm:max-lg:order-first" href={`/projects/${pid}/stack`}>Change stack</a>
          {:else if data.tab === "design" && latestRevision.status === "APPROVED"}
            <ChapterNextStep journey={data.journey} projectId={pid} chapter="design" class="sm:max-lg:order-first" />
          {:else if data.tab === "design" && latestRevision.status === "DRAFT"}
            <!-- A draft on top of an approved version is approvable too (like the
                 requirements tab): v2+ used to be stuck because approval required
                 that nothing was approved yet. -->
            <section class="card flex flex-col gap-4 border border-primary-ink bg-base-100 p-5 sm:max-lg:order-first" aria-labelledby="approve-design-title">
              <div class="flex flex-col gap-1">
                <h2 id="approve-design-title" class="text-[16px] font-bold">Approve <span class="font-mono font-medium">v{latestRevision.version}</span>?</h2>
                {#if designApproved}
                  <p class="text-[13px] text-base-content/80">Replaces <span class="font-mono">v{designApproved.version}</span>.</p>
                {/if}
              </div>
              {@render changesSummary()}
              {#if data.designIssues.length}
                <Notice tone="warn"><p class="font-semibold">Resolve these issues before approval.</p><ul class="mt-2 list-disc pl-5">{#each data.designIssues as issue}<li>{issue}</li>{/each}</ul></Notice>
                <a class="btn btn-outline" href={`/projects/${pid}/docs/design/edit`}>Edit design to resolve issues</a>
              {:else}
              <div class="[&>.btn]:w-full max-sm:[&>.btn]:h-12">
                <DecisionReceipt
                  kind="design"
                  version={latestRevision.version}
                  replaces={designApproved?.version ?? null}
                  summary={changeLine ? changeLine.charAt(0).toUpperCase() + changeLine.slice(1) : ""}
                  action="?/approveRevision"
                  fields={{ revisionId: latestRevision.id, artifactType: "design" }}
                  label={`Approve design v${latestRevision.version}`}
                />
              </div>
              {/if}
            </section>
          {/if}
          {@render history()}
        </aside>
      </div>
    {:else}
      <div class="card flex flex-col items-center gap-3 border border-line bg-base-100 px-6 py-12 text-center">
        {#if data.tab === "stack"}
          {@render emptyState(Layers, "No stack chosen yet", "Chosen after the requirements are approved.")}
          <a class="btn btn-primary mt-2" href={`/projects/${pid}/stack`}>Choose the stack</a>
        {:else}
          {@const canWrite = Boolean(stackApproved) && data.requirements.revision?.status === "APPROVED"}
          {@render emptyState(
            Network,
            "No technical design yet",
            !canWrite
              ? "Needs approved requirements and a locked stack."
              : data.ai.design
                ? "Generate it from the next step above, or write it yourself."
                : "No AI is connected for design. Write it yourself.",
          )}
          {#if canWrite}
            <a class={data.ai.design ? "btn btn-outline mt-2" : "btn btn-primary mt-2"} href={`/projects/${pid}/docs/design/edit`}>Write it yourself</a>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}

  <!-- The AI models behind these documents: secondary, behind one disclosure. -->
  {#if data.routing.effective?.length}
    <details class="group mt-2 border-t border-line pt-3 text-xs">
      <summary class="flex min-h-10 w-fit cursor-pointer list-none items-center gap-1.5 rounded-field font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
        <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />AI models in use
      </summary>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {#each data.routing.effective as route (route.role)}
          <span
            class="badge badge-sm border-line text-xs text-base-content/80"
            title={route.configured ? `${route.provider_type ?? ""} · ${route.model_id ?? ""} (${route.source})` : "Deterministic fallback in use"}
          >
            <span class="size-1.5 rounded-full {route.configured ? 'bg-mint' : 'bg-base-content/25'}" aria-hidden="true"></span>
            <span class="font-medium text-base-content">{route.role.toLowerCase().replaceAll("_", " ")}:</span>
            <span>{route.configured ? route.model_id : "fallback"}</span>
          </span>
        {/each}
      </div>
    </details>
  {/if}
</main>
