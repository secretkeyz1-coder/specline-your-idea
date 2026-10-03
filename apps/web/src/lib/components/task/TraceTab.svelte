<script lang="ts">
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import type { TaskLinkRow, TraceLink } from "$lib/task-detail.js";

  /** The traceability tab: the requirements the task serves, what it waits on, and what waits on it. */
  let { traceability, dependencies, dependents }: { traceability: TraceLink[]; dependencies: TaskLinkRow[]; dependents: TaskLinkRow[] } = $props();
</script>

<div class="flex flex-col gap-3 text-xs">
  <div>
    <p class="text-[13px] font-semibold text-base-content">
      Linked requirements
    </p>
    <ul class="mt-1.5 flex flex-col gap-2">
      {#each traceability as link}
        <li class="rounded-box border border-line bg-base-200 px-3 py-2">
          <span class="font-mono text-xs font-medium tracking-tight text-base-content/75">{link.requirement_key}{link.ac_key ? ` / ${link.ac_key}` : ""}</span>
          <span class="mt-0.5 block text-base-content/80">{link.requirement_title}</span>
        </li>
      {/each}
      {#if traceability.length === 0}
        <li class="text-base-content/80">Not linked to a requirement.</li>
      {/if}
    </ul>
  </div>

  {#if dependencies.length}
    <div class="border-t border-line pt-2.5">
      <p class="text-[13px] font-semibold text-base-content">
        Depends on
      </p>
      <ul class="mt-1.5 flex flex-col gap-1">
        {#each dependencies as dep}
          <li class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate"><span class="font-mono font-medium text-base-content">{dep.key}</span> <span class="text-base-content/80">{dep.title}</span></span>
            <StatusBadge status={dep.status} />
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if dependents.length}
    <div class="border-t border-line pt-2.5">
      <p class="text-[13px] font-semibold text-base-content">
        Blocks downstream
      </p>
      <ul class="mt-1.5 flex flex-col gap-1">
        {#each dependents as dep}
          <li class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate"><span class="font-mono font-medium text-base-content">{dep.key}</span> <span class="text-base-content/80">{dep.title}</span></span>
            <StatusBadge status={dep.status} />
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
