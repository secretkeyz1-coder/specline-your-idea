<script lang="ts">
  import "@fontsource-variable/geist";
  import "@fontsource-variable/fira-code";
  import "../app.css";
  import AppSidebar from "$lib/components/AppSidebar.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";

  let {
    data,
    children,
  }: {
    data: {
      user: { email: string; display_name: string } | null;
      projects?: Array<{ id: string; key: string; name: string; lifecycleStatus: string }>;
    };
    children: Snippet;
  } = $props();

  let searchOpen = $state(false);

  const currentProjectId = $derived.by(() => {
    const p = page.url.pathname;
    const m = p.match(/^\/(?:projects|new\/discovery)\/([0-9a-f-]+)/);
    return m ? m[1] : null;
  });

  function onGlobalKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      searchOpen = !searchOpen;
    }
  }
</script>

<svelte:window onkeydown={onGlobalKeyDown} />

<div class="app min-h-screen bg-base-200 text-base-content">
  <a class="btn btn-primary fixed -top-12 left-3 z-[100] transition-[top] duration-150 focus:top-2" href="#content">Skip to content</a>
  {#if data.user}
    <AppSidebar user={data.user} projects={data.projects ?? []} onOpenSearch={() => (searchOpen = true)} />
  {/if}
  <div id="content" tabindex="-1" class="outline-none {data.user ? 'lg:pl-64' : ''}">
    {@render children()}
  </div>
  <CommandPalette
    bind:open={searchOpen}
    projects={data.projects ?? []}
    {currentProjectId}
  />
</div>
