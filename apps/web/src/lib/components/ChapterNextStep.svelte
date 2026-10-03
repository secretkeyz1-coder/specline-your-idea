<script lang="ts">
  import NextStepBar from "./NextStepBar.svelte";
  import type { Journey, MilestoneId } from "$lib/journey.js";

  /**
   * The way on, in the body of a planning chapter whose work is done. An
   * approved document has no button of its own, and the quiet one in the
   * header was easy to miss — people went back to the sidebar. Hidden while
   * the next step is this chapter's own work, once the plan is built (the
   * build and release chapters have their own pages), and on phones, where
   * the bottom bar already carries it.
   */
  let {
    journey,
    projectId,
    chapter,
    class: cls = "",
  }: { journey: Journey | null | undefined; projectId: string | undefined; chapter: MilestoneId; class?: string } = $props();

  const show = $derived(
    Boolean(journey && !journey.finished && journey.next.milestone !== chapter && journey.next.milestone !== "build" && journey.next.milestone !== "release"),
  );
</script>

{#if show && journey && projectId}
  <div class="card border border-primary-ink bg-base-100 p-5 max-sm:hidden {cls}">
    <NextStepBar variant="panel" level={2} {journey} {projectId} />
  </div>
{/if}
