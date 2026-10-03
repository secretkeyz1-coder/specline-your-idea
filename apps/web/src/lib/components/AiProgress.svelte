<script lang="ts">
  /**
   * The one progress line for long AI calls (1–4 minutes). Every page that
   * waits on a model uses it, so a slow call never looks like a hang:
   * what is happening, roughly how long, and — after 30 s — how long so far.
   * It is a polite live region: screen readers hear the start and the
   * elapsed updates at a calm pace, not every second.
   */
  let {
    active,
    label,
    estimate,
    class: className = "",
  }: { active: boolean; label: string; estimate: string; class?: string } = $props();

  let seconds = $state(0);
  $effect(() => {
    if (!active) {
      seconds = 0;
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => (seconds = Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  });
  // Announce elapsed time in 30 s steps only; the visible counter still ticks.
  const spoken = $derived(seconds < 30 ? "" : `${Math.floor(seconds / 30) * 30} seconds so far.`);
  const shown = $derived(seconds < 30 ? "" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
</script>

<!-- The live region stays mounted (empty when idle) so screen readers catch the start.
     While a call runs it reads as AI activity: the sky tint the Stack rows use when suggesting. -->
<div class={className} role="status" aria-live="polite">
  {#if active}
    <div class="flex w-fit max-w-full items-center gap-2.5 rounded-box border border-sky/40 bg-sky-soft px-3 py-2 text-[13px] max-sm:w-full">
      <span class="loading loading-spinner loading-xs shrink-0 text-sky" aria-hidden="true"></span>
      <span class="min-w-0 flex-1">
        <span class="font-medium">{label}</span><span class="text-base-content/75"> · {estimate}</span>
      </span>
      {#if shown}<span class="shrink-0 font-mono text-xs tabular-nums text-base-content/75" aria-hidden="true">{shown}</span>{/if}
    </div>
    <span class="sr-only">{spoken}</span>
  {/if}
</div>
