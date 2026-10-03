<script lang="ts">
  import { STATUS_META, type WorkflowStatus } from "$lib/status.js";

  let { status }: { status: string } = $props();
  const meta = $derived(STATUS_META[status as WorkflowStatus] ?? STATUS_META.DRAFT);
  const Icon = $derived(meta.icon);
  // base-300 is a well (darker than the surfaces): a quiet badge's edge is a hairline.
  const tone = $derived(meta.cls.replace("border-base-300", "border-line"));
</script>

<span class={`badge badge-sm h-[22px] shrink-0 gap-1.5 rounded-field px-2.5 text-xs font-semibold tracking-tight whitespace-nowrap ${tone}`}>
  <Icon class="size-3 shrink-0" aria-hidden="true" />
  <span>{meta.label}</span>
</span>
