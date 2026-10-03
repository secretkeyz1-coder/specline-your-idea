<script lang="ts">
  import { Check } from "lucide-svelte";
  import type { DsDirection, DsDirectionId } from "$lib/types.js";

  /**
   * The five visual directions (adopted from open-design): each card shows its
   * mood, palette, a font sample and the first posture rules. Choosing one is
   * the parent's job (it replaces the palettes and fonts, keeps the rest).
   */
  let {
    directions,
    active,
    onChoose,
  }: {
    directions: DsDirection[];
    active: DsDirectionId | undefined;
    onChoose: (direction: DsDirection) => void;
  } = $props();

  const STRIP = ["bg", "surface2", "fgMuted", "accent", "fg"] as const;
</script>

<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Visual direction">
  {#each directions as d (d.id)}
    {@const on = active === d.id}
    <label
      class="flex cursor-pointer flex-col gap-2 rounded-box border px-3.5 py-3 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-ink {on
        ? 'border-primary-ink bg-primary-soft'
        : 'border-line bg-base-200 hover:bg-base-100'}"
    >
      <input class="sr-only" type="radio" name="direction" value={d.id} checked={on} onchange={() => onChoose(d)} />
      <span class="flex items-center gap-2">
        <span class="min-w-0 flex-1 font-semibold">{d.label}</span>
        {#if on}<Check class="size-3.5 shrink-0 text-primary-ink" aria-hidden="true" />{/if}
      </span>
      <span class="flex overflow-hidden rounded-field border border-line" aria-hidden="true">
        {#each STRIP as k (k)}<span class="h-3.5 flex-1" style="background: {d.light[k]}"></span>{/each}
      </span>
      <!-- The font sample is drawn in the direction's own stacks (system fallbacks where a family isn't installed). -->
      <span class="flex items-baseline gap-2 truncate" aria-hidden="true">
        <span class="text-[17px] leading-tight" style="font-family: {d.fonts.display}">Aa</span>
        <span class="truncate text-xs text-base-content/80" style="font-family: {d.fonts.body}">The quick brown fox</span>
      </span>
      <span class="text-xs leading-relaxed text-base-content/80">{d.mood}</span>
      <ul class="flex list-disc flex-col gap-0.5 ps-4 text-xs leading-relaxed text-base-content/80">
        {#each d.posture.slice(0, 3) as rule, i (i)}<li>{rule}</li>{/each}
      </ul>
      {#if d.references.length}
        <span class="truncate text-xs text-base-content/75" title={d.references.join(", ")}>Like {d.references.join(", ")}</span>
      {/if}
    </label>
  {/each}
</div>
