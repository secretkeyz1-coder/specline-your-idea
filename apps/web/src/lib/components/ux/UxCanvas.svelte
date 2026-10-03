<script lang="ts">
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import type { ComponentProps } from "svelte";
  import UxWorkspace from "./UxWorkspace.svelte";

  /** The canvas needs the flow context for its viewport controls; this provides it. */
  let props: ComponentProps<typeof UxWorkspace> = $props();
</script>

<SvelteFlowProvider>
  <UxWorkspace {...props} />
</SvelteFlowProvider>
