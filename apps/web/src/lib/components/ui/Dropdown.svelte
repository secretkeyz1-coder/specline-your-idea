<script lang="ts">
  // daisyUI dropdown on the popover API: the trigger gets popovertarget and
  // an anchor name, the panel opens in the top layer next to it, and the
  // browser closes it on Esc or a click outside (light dismiss).
  import type { Snippet } from "svelte";

  type TriggerProps = { popovertarget: string; style: string; "aria-expanded": boolean };

  let {
    open = $bindable(false),
    placement = "bottom",
    align = "start",
    class: className = "",
    trigger,
    children,
  }: {
    open?: boolean;
    placement?: "bottom" | "top";
    align?: "start" | "center" | "end";
    /** The panel box: background, border, width, padding, layout. */
    class?: string;
    trigger: Snippet<[TriggerProps]>;
    children: Snippet;
  } = $props();

  const uid = $props.id();
  const id = `dd-${uid}`;
  let panel = $state<HTMLElement>();

  $effect(() => {
    if (!panel) return;
    const shown = panel.matches(":popover-open");
    if (open && !shown) panel.showPopover();
    else if (!open && shown) panel.hidePopover();
  });
</script>

{@render trigger({ popovertarget: id, style: `anchor-name: --${id}`, "aria-expanded": open })}
<div
  bind:this={panel}
  {id}
  popover
  class="dropdown dropdown-{placement} dropdown-{align} my-1.5"
  style="position-anchor: --{id}"
  ontoggle={(e) => (open = (e as ToggleEvent).newState === "open")}
>
  <!-- The panel's own classes go on this inner box: a display utility on the
       popover element itself would show it while closed. -->
  {#if open}<div class={className}>{@render children()}</div>{/if}
</div>
