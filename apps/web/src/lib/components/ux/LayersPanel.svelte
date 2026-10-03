<script lang="ts">
  import { ChevronDown, ChevronRight, SquareStack } from "lucide-svelte";
  import type { LayerNode } from "$lib/ux-canvas.js";

  /**
   * The layers of the canvas: every screen and overlay artboard, and the
   * component tree of the artboard in focus — built from the mockup's DOM, so
   * it names what the design shows ("Table · 6 columns"), not wrapper divs.
   */
  let {
    boards,
    focusedBoard,
    tree,
    selectedEl,
    onPickBoard,
    onPickLayer,
  }: {
    boards: Array<{ id: string; title: string; subtitle: string; kind: "screen" | "overlay"; comments: number; n: number; label: string; device: string | null }>;
    focusedBoard: string | null;
    tree: LayerNode[];
    selectedEl: Element | null;
    onPickBoard: (nodeId: string) => void;
    onPickLayer: (el: Element) => void;
  } = $props();

  let collapsed = $state(new Set<Element>());
  function toggle(el: Element) {
    const next = new Set(collapsed);
    if (next.has(el)) next.delete(el);
    else next.add(el);
    collapsed = next;
  }
  const holds = (layer: LayerNode, el: Element | null): boolean => Boolean(el && (layer.el === el || layer.el.contains(el)));
</script>

{#snippet layers(items: LayerNode[], depth: number)}
  <!-- daisyUI menu: nested lists indent and draw the tree's guide lines. -->
  <ul class={depth === 0 ? "menu menu-xs w-full p-0 [--menu-active-bg:var(--color-primary-soft)] [--menu-active-fg:var(--color-base-content)]" : ""}>
    {#each items as layer (layer.el)}
      {@const open = !collapsed.has(layer.el) && (depth < 2 || holds(layer, selectedEl))}
      <li>
        <div class="flex gap-0 p-0 text-[12px] {layer.el === selectedEl ? 'menu-active font-semibold' : 'text-base-content/80'}">
          {#if layer.children.length}
            <button type="button" class="btn btn-ghost btn-xs btn-square shrink-0" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onclick={() => toggle(layer.el)}>
              {#if open}<ChevronDown class="size-3" aria-hidden="true" />{:else}<ChevronRight class="size-3" aria-hidden="true" />{/if}
            </button>
          {:else}
            <span class="size-6 shrink-0"></span>
          {/if}
          <button type="button" class="min-w-0 flex-1 truncate py-1 pr-2 text-left" onclick={() => onPickLayer(layer.el)} title={layer.label}>
            {layer.label}
          </button>
        </div>
        {#if open && layer.children.length}
          {@render layers(layer.children, depth + 1)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<!-- Quiet: the screens as a numbered list, then the layers of the one in focus. The picked row gets a soft primary tint. -->
<div class="flex h-full min-h-0 flex-col text-[13px]">
  <p class="px-4 pb-1.5 pt-3.5 text-xs font-medium text-base-content/75">Screens</p>
  <ul class="flex max-h-[45%] shrink-0 flex-col gap-0.5 overflow-y-auto px-2.5" aria-label="Screens and overlays">
    {#each boards as board (board.id)}
      {@const active = focusedBoard === board.id}
      <li>
        <button
          type="button"
          onclick={() => onPickBoard(board.id)}
          class="flex min-h-8 w-full items-center gap-2.5 rounded-field px-2 py-1 text-left transition-colors {active ? 'bg-primary-soft font-semibold text-base-content' : 'text-base-content/80 hover:bg-base-content/6 hover:text-base-content'} {board.kind === 'overlay' ? 'ps-6' : ''}"
          aria-current={active ? "true" : undefined}
          title={board.title}
        >
          {#if board.kind === "overlay"}
            <SquareStack class="size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />
          {:else}
            <span class="w-3.5 shrink-0 text-xs tabular-nums text-base-content/75">{board.n}</span>
          {/if}
          <span class="min-w-0 flex-1 truncate">{board.label}{#if board.device}<span class="font-normal text-base-content/75"> · {board.device}</span>{/if}</span>
          {#if board.comments}
            <span class="size-2 shrink-0 rounded-full bg-sky" aria-hidden="true"></span>
            <span class="sr-only">{board.comments} open comment{board.comments === 1 ? "" : "s"}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
  <p class="mt-3 border-t border-line px-4 pb-1.5 pt-3.5 text-xs font-medium text-base-content/75">Layers</p>
  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
    {#if tree.length}
      {@render layers(tree, 0)}
    {:else}
      <p class="px-2 text-xs text-base-content/75">Pick a screen to see its layers.</p>
    {/if}
  </div>
</div>
