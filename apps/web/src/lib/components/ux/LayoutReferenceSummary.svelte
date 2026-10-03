<script lang="ts">
  import type { LayoutReference } from "$lib/types.js";

  /** What a layout reference says, read back: its kind of page, regions and patterns. */
  let { reference, full = false }: { reference: LayoutReference; full?: boolean } = $props();
  const b = $derived(reference.brief);
</script>

<div class="flex min-w-0 flex-col gap-2 text-[13px]">
  <div class="min-w-0">
    <p class="truncate font-semibold text-base-content" title={reference.name}>{reference.name}</p>
    <p class="text-base-content/80">{b.archetype}</p>
    <p class="text-xs text-base-content/75">{reference.mode === "adapt" ? "Template appearance + structure" : "Layout only · project design system"}</p>
  </div>
  {#if b.patterns.length}
    <ul class="flex flex-wrap gap-1" aria-label="Patterns">
      {#each b.patterns as pattern (pattern)}<li class="badge badge-sm border-line bg-base-200 font-medium text-base-content/80">{pattern}</li>{/each}
    </ul>
  {/if}
  {#if full}
    {#if reference.design_system}
      <p class="text-base-content/80">Visual system: {reference.design_system.name} · {reference.design_system.fonts.body} · {reference.design_system.density}</p>
    {/if}
    {#if reference.notes?.length}
      <ul class="list-disc ps-5 text-xs text-base-content/75">{#each reference.notes as note}<li>{note}</li>{/each}</ul>
    {/if}
    {#if b.regions.length}
      <div>
        <p class="text-xs font-semibold text-base-content/80">Regions, top to bottom</p>
        <ol class="mt-1 flex list-decimal flex-col gap-0.5 ps-5 text-base-content/80">
          {#each b.regions as region, i (i)}<li><span class="text-base-content">{region.name}</span>{#if region.role}<span> — {region.role}</span>{/if}</li>{/each}
        </ol>
      </div>
    {/if}
    <dl class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-base-content/80">
      {#if b.grid}<dt class="text-base-content/75">Grid</dt><dd>{b.grid}</dd>{/if}
      <dt class="text-base-content/75">Density</dt><dd class="capitalize">{b.density}</dd>
      {#if b.emphasis}<dt class="text-base-content/75">Emphasis</dt><dd>{b.emphasis}</dd>{/if}
    </dl>
  {/if}
</div>
