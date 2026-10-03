<script lang="ts">
  import { page } from "$app/state";
  import { Bug, Kanban } from "lucide-svelte";

  /** The Build chapter's two views: the live board of task runs, and the bugs found in the built work. */
  let { projectId, bugCount = null }: { projectId: string; bugCount?: number | null } = $props();
  const onBugs = $derived(page.url.pathname.endsWith("/bugs"));
</script>

<nav class="join self-start" aria-label="Build views">
  <a
    href={`/projects/${projectId}/board`}
    class="btn btn-sm join-item border-line max-sm:h-11 max-sm:px-4 {onBugs ? 'bg-base-200 text-base-content/80' : 'btn-active'}"
    aria-current={onBugs ? undefined : "page"}
  >
    <Kanban class="size-3.5" aria-hidden="true" />Board
  </a>
  <a
    href={`/projects/${projectId}/bugs`}
    class="btn btn-sm join-item border-line max-sm:h-11 max-sm:px-4 {onBugs ? 'btn-active' : 'bg-base-200 text-base-content/80'}"
    aria-current={onBugs ? "page" : undefined}
  >
    <Bug class="size-3.5" aria-hidden="true" />Bugs{#if bugCount}<span
        class="inline-grid h-[18px] min-w-[18px] place-items-center rounded-field border border-line bg-base-100 px-1.5 text-xs font-semibold tabular-nums text-base-content/80"
        ><span class="sr-only">, </span>{bugCount}<span class="sr-only"> open</span></span
      >{/if}
  </a>
</nav>
