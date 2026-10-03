<script lang="ts">
    import NextStepBar from "$lib/components/NextStepBar.svelte";
  import { ChevronRight } from "lucide-svelte";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { chapterFor, type Journey } from "$lib/journey.js";

  let {
    data,
    children,
  }: {
    data: { project: { id: string; key: string; name: string; lifecycleStatus: string }; journey: Journey };
    children: Snippet;
  } = $props();

  // Every project page belongs to one chapter of the notebook; its title
  // names it: "<chapter> — <KEY> <name>" (a task page names the task).
  const chapter = $derived(chapterFor(page.url.pathname, page.url.searchParams, data.project.id));
  const pageTitle = $derived.by(() => {
    const task = (page.data as { task?: { key?: string; title?: string } }).task;
    if (chapter === "tasks" && task?.key) return `${task.key} ${task.title ?? ""}`.trim();
    if (page.url.pathname.endsWith("/bugs")) return "Bugs";
    return chapter === "overview" ? "Notebook" : (data.journey.milestones.find((m) => m.id === chapter)?.label ?? "Project");
  });
  // The notebook page shows the next step inside its current chapter; every
  // other page carries it at the end of the spine.
  const onNotebook = $derived(chapter === "overview");
  // The UI reference is a canvas: it takes the whole width and height below the spine.
  const fullBleed = $derived(page.url.pathname.endsWith("/ux"));
  // The canvas has no room for a next-step card: once its screens are settled,
  // the header button is the way on, so it is the page's primary button.
  const prominentNext = $derived(fullBleed && !["screens", "build", "release"].includes(data.journey.next.milestone));
</script>

<svelte:head>
  <title>{pageTitle} — {data.project.key} {data.project.name}</title>
</svelte:head>

<!-- The chapters live in the sidebar; this bar names the page and carries the next step.
     Phones: the bar folds away (the top bar names the project, the page's h1 names the page) and
     the next step is the fixed bottom bar. `contents` also drops the blur's containing block, which
     otherwise pinned that fixed bar inside this one. -->
<div class="sticky top-14 z-20 border-b border-line bg-base-200/95 backdrop-blur-md max-sm:contents lg:top-0">
  <div class="mx-auto flex min-h-14 max-w-[1380px] items-center justify-between gap-3 px-4 max-sm:contents sm:px-6 lg:px-10">
    <nav class="flex min-w-0 items-center gap-2 text-[13px] max-sm:hidden" aria-label="Breadcrumb">
      <a href={`/projects/${data.project.id}`} class="hidden min-w-0 truncate text-base-content/80 hover:text-base-content sm:inline">{data.project.name}</a>
      <ChevronRight class="hidden size-3 shrink-0 text-base-content/75 sm:block" aria-hidden="true" />
      <span class="min-w-0 truncate font-medium" aria-current="page">{pageTitle}</span>
    </nav>
    {#if !onNotebook}<NextStepBar journey={data.journey} projectId={data.project.id} variant="inline" prominent={prominentNext} />{/if}
  </div>
</div>

{#if fullBleed}
  {@render children()}
{:else}
  <div class="mx-auto w-full max-w-[1380px] px-4 sm:px-6 lg:px-10 pb-20 pt-5 sm:pt-8">
    {@render children()}
  </div>
{/if}
