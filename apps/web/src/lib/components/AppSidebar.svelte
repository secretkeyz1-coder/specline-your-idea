<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { afterNavigate } from "$app/navigation";
  import {
    BookOpen,
    Check,
    ChevronLeft,
    Cpu,
    LogOut,
    Menu,
    Minus,
    Moon,
    PenLine,
    Search,
    Sparkles,
    Sun,
    Sunrise,
    X,
  } from "lucide-svelte";
  import { chapterFor, type Journey, type Milestone } from "$lib/journey.js";

  /**
   * The app's one navigation: a sidebar from lg up, a drawer on smaller
   * screens. Outside a project it lists Today and the projects; inside one it
   * shows the notebook and the nine chapters as a vertical "spec line" (the
   * logo's motif): done, draft awaiting approval, next up, not started,
   * skipped. The page's chapter is highlighted with aria-current="page".
   */
  let {
    user,
    projects = [],
    onOpenSearch,
  }: {
    user: { email: string; display_name: string };
    projects?: Array<{ id: string; key: string; name: string; lifecycleStatus: string }>;
    onOpenSearch?: () => void;
  } = $props();

  const pathname = $derived(page.url.pathname);
  const project = $derived((page.data as { project?: { id: string; key: string; name: string } }).project ?? null);
  const journey = $derived((page.data as { journey?: Journey }).journey ?? null);
  const active = $derived(project ? chapterFor(pathname, page.url.searchParams, project.id) : null);

  let open = $state(false);
  afterNavigate(() => (open = false));
  let menuButton = $state<HTMLButtonElement | null>(null);
  let drawer = $state<HTMLElement | null>(null);
  // An open drawer takes the focus; Escape (or the backdrop) closes it and hands the focus back.
  $effect(() => {
    if (open) setTimeout(() => drawer?.querySelector<HTMLElement>("a[href], button")?.focus(), 0);
  });
  function close() {
    if (!open) return;
    open = false;
    menuButton?.focus();
  }

  let isApple = $state(false);
  let dark = $state(true);
  onMount(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    isApple = /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
    dark = document.documentElement.dataset.theme !== "forest-light";
  });
  const shortcut = $derived(isApple ? "⌘K" : "Ctrl K");

  // "forest" is the default; the button pins either theme and remembers it
  // (app.html applies the remembered choice before first paint).
  function toggleTheme() {
    dark = !dark;
    const theme = dark ? "forest" : "forest-light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("sdd-theme", theme);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  const initials = $derived(
    (user.display_name || user.email)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
  );

  const projectInitials = $derived(
    project
      ? project.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase()
      : "",
  );

  const STATE_TEXT: Record<Milestone["state"], string> = {
    done: "done",
    draft: "draft waiting for your approval",
    current: "next up",
    todo: "not started",
    skipped: "skipped",
  };

  const ITEM =
    "flex h-9 min-w-0 items-center gap-2.5 rounded-field px-2.5 text-[13px] font-medium text-base-content/80 transition-colors hover:bg-base-200 hover:text-base-content aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-base-content pointer-coarse:h-11 max-sm:h-11";
</script>

{#snippet node(m: Milestone)}
  <span
    class="relative z-10 inline-grid size-5.5 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold leading-none tabular-nums {m.state === 'done'
      ? 'border-mint bg-mint text-base-100'
      : m.state === 'draft'
        ? 'border-warn bg-warn-soft text-warn'
        : m.state === 'current'
          ? 'border-primary bg-primary text-primary-content ring-4 ring-primary-soft'
          : 'border-line-control bg-base-100 text-base-content/75'}"
    aria-hidden="true"
  >
    {#if m.state === "done"}<Check class="size-3" strokeWidth={3} />{:else if m.state === "skipped"}<Minus class="size-3" />{:else if m.state === "draft"}<PenLine class="size-3" strokeWidth={2.5} />{:else}{m.n}{/if}
  </span>
{/snippet}

<!-- Phones and tablets: a slim bar with the menu button -->
<div class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-base-100/95 px-3 backdrop-blur-md max-sm:px-2 lg:hidden">
  <button type="button" bind:this={menuButton} class="btn btn-ghost btn-square size-11" aria-label="Open navigation" aria-expanded={open} aria-controls="app-sidebar" onclick={() => (open = true)}>
    <Menu class="size-5" aria-hidden="true" />
  </button>
  <a href="/" class="flex min-w-0 items-center gap-2 max-sm:flex-1" aria-label="speclineyouridea — Today">
    {#if project}
      <!-- Phones: the project's badge instead of the logo, as in the drawer. -->
      <span class="flex max-sm:hidden">{@render mark(20)}</span>
      <span class="hidden size-6.5 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-content max-sm:grid" aria-hidden="true">{projectInitials}</span>
    {:else}
      {@render mark(20)}
    {/if}
    <span class="truncate text-[14px] font-bold tracking-tight max-sm:text-[15px]">{project ? project.name : "specline"}{#if !project}<span class="text-primary-ink">youridea</span>{/if}</span>
  </a>
  <button type="button" class="btn btn-ghost btn-square ml-auto size-11" aria-label="Search" onclick={() => onOpenSearch?.()}>
    <Search class="size-4" aria-hidden="true" />
  </button>
</div>

{#if open}
  <button type="button" class="fixed inset-0 z-[45] bg-base-300/70 max-sm:bg-base-300/75 lg:hidden" aria-label="Close navigation" onclick={close}></button>
{/if}

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<!-- Closed below lg it is invisible, not just off-screen: its links leave the
     tab order and the accessibility tree. Visibility is transitioned so it
     only turns hidden once the slide-out has finished. -->
<aside
  id="app-sidebar"
  bind:this={drawer}
  class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r max-sm:w-[min(300px,85vw)] border-line bg-base-100 px-3.5 pt-4 pb-3 transition-[translate,transform,visibility] duration-200 lg:visible lg:z-20 lg:translate-x-0 {open ? 'translate-x-0' : 'invisible -translate-x-full'}"
  aria-label="Navigation"
>
  <div class="flex items-center justify-between gap-2 px-2 pb-4 max-sm:gap-1 max-sm:pr-0 max-sm:pb-3 {project ? 'max-sm:pl-0' : ''}">
    {#if project}
      <a href="/" class="flex min-w-0 items-center gap-2 text-[13px] text-base-content/80 hover:text-base-content max-sm:min-h-11 max-sm:flex-1 max-sm:px-2">
        <ChevronLeft class="size-4 shrink-0" aria-hidden="true" />
        {@render mark(18)}
        <span class="font-bold tracking-tight text-base-content">specline<span class="text-primary-ink">youridea</span></span>
      </a>
    {:else}
      <a href="/" class="flex min-w-0 items-center gap-2.5" aria-label="speclineyouridea — Today">
        {@render mark(24)}
        <span class="text-[15px] font-bold tracking-tight">specline<span class="text-primary-ink">youridea</span></span>
      </a>
    {/if}
    <button type="button" class="btn btn-ghost btn-square btn-sm max-sm:size-11 lg:hidden" aria-label="Close navigation" onclick={() => (open = false)}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </div>

  <button
    type="button"
    onclick={() => onOpenSearch?.()}
    class="flex h-9 w-full items-center gap-2 rounded-field border border-line bg-base-200 pr-2 pl-3 text-[13px] text-base-content/75 hover:border-line-control max-sm:h-11 {project ? 'max-sm:hidden' : ''}"
  >
    <Search class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="flex-1 text-left">Search</span>
    <kbd class="kbd kbd-sm font-mono text-xs max-sm:hidden">{shortcut}</kbd>
  </button>

  <nav class="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto max-sm:mt-3 {project ? 'max-sm:mt-0' : ''}" aria-label={project ? "Project" : "Workspace"}>
    {#if project && journey}
      <div class="flex items-center gap-2.5 rounded-box border border-line bg-base-200 p-2.5 max-sm:min-h-14">
        <span class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary text-xs font-bold text-primary-content" aria-hidden="true">{projectInitials}</span>
        <span class="flex min-w-0 flex-col" title={`${project.key} — ${project.name}`}>
          <span class="truncate text-[13px] font-semibold">{project.name}</span>
          <span class="hidden font-mono text-xs text-base-content/75 max-sm:block">{project.key}</span>
        </span>
      </div>
      <a href={`/projects/${project.id}`} class="{ITEM} mt-3 max-sm:mt-2" aria-current={active === "overview" ? "page" : undefined}>
        <BookOpen class="size-4 shrink-0" aria-hidden="true" />Notebook
      </a>
      <p class="px-2.5 pt-4 pb-2 text-xs font-medium text-base-content/75 max-sm:pt-2.5 max-sm:pb-1">Chapters</p>
      <ol class="relative flex flex-col before:absolute before:top-3.5 before:bottom-3.5 before:left-[21px] before:w-0.5 before:rounded-full before:bg-line">
        {#each journey.milestones as m (m.id)}
          <li>
            <a
              href={m.href}
              class="{ITEM} relative gap-3 {m.state === 'skipped' ? 'text-base-content/75' : ''}"
              aria-current={m.id === active ? "page" : undefined}
              title={`${m.n}. ${m.label}${m.optional ? " (optional)" : ""} — ${m.summary}`}
            >
              {@render node(m)}
              <span class="truncate">{m.label}</span>
              {#if m.optional}<span class="ms-auto hidden shrink-0 text-xs font-medium text-base-content/75 max-sm:inline" aria-hidden="true">optional</span>{/if}
              <span class="sr-only">— chapter {m.n} of {journey.total}, {STATE_TEXT[m.state]}{m.optional ? ", optional" : ""}</span>
            </a>
          </li>
        {/each}
      </ol>
    {:else}
      <a href="/" class={ITEM} aria-current={pathname === "/" ? "page" : undefined}>
        <Sunrise class="size-4 shrink-0" aria-hidden="true" />Today
      </a>
      {#if projects.length}
        <p class="px-2.5 pt-5 pb-2 text-xs font-medium text-base-content/75">Projects</p>
        {#each projects.slice(0, 8) as p (p.id)}
          <a href={`/projects/${p.id}`} class={ITEM} title={`${p.key} — ${p.name}`}>
            <span class="size-2 shrink-0 rounded-full {p.lifecycleStatus === 'COMPLETE' ? 'bg-mint' : 'bg-line-control'}" aria-hidden="true"></span>
            <span class="truncate">{p.name}</span>
          </a>
        {/each}
        {#if projects.length > 8}
          <a href="/" class="{ITEM} text-base-content/75">All {projects.length} projects</a>
        {/if}
      {/if}
    {/if}
  </nav>

  <div class="mt-3 flex flex-col gap-0.5 {project ? 'max-sm:border-t max-sm:border-line max-sm:pt-2' : ''}">
    <a href="/settings/ai" class={ITEM} aria-current={pathname.startsWith("/settings/ai") ? "page" : undefined}>
      <Sparkles class="size-4 shrink-0" aria-hidden="true" />AI providers
    </a>
    <a href="/machines" class={ITEM} aria-current={pathname.startsWith("/machines") ? "page" : undefined}>
      <Cpu class="size-4 shrink-0" aria-hidden="true" />Machines
    </a>
  </div>

  <div class="mt-3 flex items-center gap-2 border-t border-line px-1 pt-3 max-sm:gap-1 max-sm:pt-2">
    <span class="grid size-8 shrink-0 place-items-center rounded-full bg-neutral text-xs font-bold text-neutral-content max-sm:mr-1.5" aria-hidden="true">{initials}</span>
    <span class="min-w-0 flex-1 truncate text-[13px] font-semibold" title={user.email}>
      {user.display_name}<span class="sr-only"> (signed in as {user.email})</span>
    </span>
    <button type="button" class="btn btn-ghost btn-square btn-sm pointer-coarse:size-10 max-sm:size-11" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onclick={toggleTheme}>
      {#if dark}<Sun class="size-4" aria-hidden="true" />{:else}<Moon class="size-4" aria-hidden="true" />{/if}
    </button>
    <form action="/logout" method="post" class="inline-flex">
      <button class="btn btn-ghost btn-square btn-sm pointer-coarse:size-10 max-sm:size-11" aria-label="Sign out" type="submit">
        <LogOut class="size-4" aria-hidden="true" />
      </button>
    </form>
  </div>
</aside>

{#snippet mark(size: number)}
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
    <rect width="24" height="24" rx="7" fill="var(--color-primary)" />
    <path d="M6 7.5h12M6 12h7M6 16.5h9.5" stroke="var(--color-primary-content)" stroke-width="2.2" stroke-linecap="round" />
    <circle cx="17.5" cy="12" r="2" fill="var(--color-primary-content)" />
  </svg>
{/snippet}
