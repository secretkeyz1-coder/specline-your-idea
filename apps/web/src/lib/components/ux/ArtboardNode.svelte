<script lang="ts" module>
  export interface ArtboardData extends Record<string, unknown> {
    title: string;
    /** The screen's place in the plan (screens only), shown before its name. */
    number?: number;
    subtitle: string;
    /** The mockup document, already framed with the CSP (framedMockup). */
    srcdoc: string | null;
    width: number;
    /** The viewport height of the frame preset: the least the artboard is tall. */
    frameHeight: number;
    kind: "screen" | "overlay";
    screenKey: string;
    status: "drawn" | "empty" | "drawing" | "failed";
    /**
     * Shared, reactive canvas state. Selection and tool changes are read from
     * here instead of rebuilding the nodes: a rebuild re-fitted the viewport
     * and moved the page under the pointer mid double-click.
     */
    ui: { selectedId: string | null; interactive: boolean; zoom?: number };
    /** The screen being drawn (shared, like `ui`): this artboard follows it when it is the one. */
    live?: import("$lib/ux.js").LiveDraw;
    canDraw: boolean;
    onDoc: (nodeId: string, doc: Document) => void;
    /** The document went away (the artboard unmounted, or the mockup is reloading with new content). */
    onDocGone: (nodeId: string, doc: Document) => void;
    onHeight: (nodeId: string, height: number) => void;
    onSelectBoard: (nodeId: string) => void;
    onDraw: (screenKey: string) => void;
  }
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { Monitor, Smartphone, SquareStack, Sparkles } from "lucide-svelte";
  import { onDestroy, untrack } from "svelte";
  import { UX_OD_MARKERS, pinViewportHeight } from "$lib/ux-canvas.js";

  /**
   * One artboard on the UI-reference canvas: a screen at a device width, or
   * one overlay (dialog, sheet, confirmation, state) of a screen. The mockup is
   * an iframe with sandbox="allow-same-origin" and no allow-scripts: nothing
   * in it runs, and the canvas reads its DOM to select and edit elements. It
   * is a real viewport (the frame preset) and longer only when the page
   * scrolls, like a frame in a design tool; a dashed line marks the fold.
   */
  let { id, data }: NodeProps & { data: ArtboardData } = $props();

  let frame = $state<HTMLIFrameElement | null>(null);
  let height = $state(0);
  let doc = $state.raw<Document | null>(null);
  const shown = $derived(height || data.frameHeight);

  /**
   * Measure content at the device viewport, including custom and inline CSS.
   * Growing the artboard must not grow viewport-relative content in turn.
   */
  function measure() {
    if (!doc?.body || !frame) return;
    pinViewportHeight(doc, data.frameHeight);
    // scrollHeight can retain the previous iframe viewport as its lower bound.
    // Measure at the preset so a shorter edit/device change can shrink again.
    frame.style.height = `${data.frameHeight}px`;
    const next = Math.max(Math.ceil(doc.body.scrollHeight), data.frameHeight);
    frame.style.height = `${next}px`;
    if (Math.abs(next - shown) > 2) {
      height = next;
      data.onHeight(id, next);
    }
  }

  let settle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tell the canvas this artboard's document is gone. The canvas edits the
   * screen through the documents it holds; one left behind after its artboard
   * unmounted (Desktop → Mobile) or reloaded kept the old content, and a later
   * edit saved from it silently took back every change made since.
   */
  function release() {
    if (settle) clearTimeout(settle);
    settle = null;
    const gone = doc;
    doc = null;
    if (gone) data.onDocGone(id, gone);
  }

  function loaded() {
    const d = frame?.contentDocument;
    if (!d) return;
    if (doc && doc !== d) release();
    doc = d;
    // The canvas stylesheet (overlays hidden, shell pinned) goes in before measuring.
    data.onDoc(id, d);
    measure();
    // Layout settles after fonts and images; measure once more.
    if (settle) clearTimeout(settle);
    settle = setTimeout(measure, 300);
  }

  // New content: the iframe reloads, and the document it had is detached now.
  let shownSrcdoc: string | null = untrack(() => data.srcdoc);
  $effect(() => {
    const next = data.srcdoc;
    if (next === shownSrcdoc) return;
    shownSrcdoc = next;
    untrack(release);
  });

  onDestroy(release);

  /**
   * Drawing live: the content that has arrived goes into the frame's <main>
   * (sanitized by the API, and the frame runs no code), and a cursor sits
   * where the drawing ends, the way a design tool shows someone at work.
   */
  const drawingHere = $derived(data.kind === "screen" && data.status === "drawing" && data.live?.key === data.screenKey);
  type Box = { x: number; y: number; w: number; h: number };
  let cursor = $state<{ x: number; y: number; box: Box | null } | null>(null);

  function cursorAt(main: Element): { x: number; y: number; box: Box | null } {
    let el: Element = main;
    while (el.lastElementChild) el = el.lastElementChild;
    let r = el.getBoundingClientRect();
    // Climb from an empty or hidden leaf to the nearest thing with a size.
    while (el !== main && (r.width < 4 || r.height < 4) && el.parentElement) {
      el = el.parentElement;
      r = el.getBoundingClientRect();
    }
    if (el === main && !main.children.length) return { x: r.left + 32, y: r.top + 32, box: null };
    const box = el === main ? null : { x: r.left, y: r.top, w: r.width, h: r.height };
    // Room for the label, which keeps its on-screen size at any zoom.
    return { x: Math.max(8, Math.min(r.right, data.width - 90 / Math.max(data.ui.zoom ?? 1, 0.1))), y: Math.max(8, r.bottom - 6), box };
  }

  $effect(() => {
    const live = data.live;
    if (!drawingHere || !doc || !live) {
      cursor = null;
      return;
    }
    const html = live.content;
    void live.checking;
    // A kit stream fills the content region of the frame; an open-design
    // stream may carry the whole body (its shell included): it fills the body.
    const whole = html.includes(`${UX_OD_MARKERS.app}`) || !doc.querySelector("[data-screen-content]");
    const main = whole ? doc.body : doc.querySelector("[data-screen-content]");
    if (!main) return;
    if (main.innerHTML !== html) main.innerHTML = html;
    untrack(measure);
    cursor = cursorAt(main);
  });

  // A new frame preset or width: measure the same page again.
  $effect(() => {
    void data.frameHeight;
    void data.width;
    if (!doc) return;
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="artboard" style:width="{data.width}px" class:is-selected={data.ui.selectedId === id}>
  <Handle type="target" position={Position.Left} id="l" class="artboard-handle" />
  <Handle type="target" position={Position.Top} id="t" class="artboard-handle" />
  <Handle type="source" position={Position.Right} id="r" class="artboard-handle" />
  <Handle type="source" position={Position.Bottom} id="b" class="artboard-handle" />

  <button type="button" class="btn btn-ghost btn-xs h-auto max-w-full flex-nowrap justify-start gap-1.5 px-1 py-0.5 text-[13px] font-normal {data.ui.selectedId === id ? 'text-primary-ink' : 'text-base-content'}" onclick={() => data.onSelectBoard(id)}>
    {#if data.kind === "overlay"}<SquareStack class="size-3.5" aria-hidden="true" />{:else if data.width < 600}<Smartphone class="size-3.5" aria-hidden="true" />{:else}<Monitor class="size-3.5" aria-hidden="true" />{/if}
    <span class="truncate font-semibold">{#if data.number}{data.number} · {/if}{data.title}</span>
    <span class="truncate text-base-content/75">{data.subtitle}</span>
  </button>

  <div class="artboard-body">
    {#if data.srcdoc}
      <iframe
        bind:this={frame}
        title={`${data.title} — ${data.subtitle}`}
        sandbox="allow-same-origin"
        srcdoc={data.srcdoc}
        onload={loaded}
        style:height="{shown}px"
        style:pointer-events={data.ui.interactive ? "auto" : "none"}
        class:nodrag={data.ui.interactive}
        class:nowheel={data.ui.interactive}
      ></iframe>
    {:else}
      <div class="flex flex-col items-center justify-center gap-3 bg-base-200 text-[14px] text-base-content/80" style:height="{data.frameHeight}px">
        {#if data.status === "drawing"}
          <span class="loading loading-spinner loading-md" aria-hidden="true"></span>
          <p>Drawing this screen…</p>
        {:else}
          <p>{data.status === "failed" ? "Drawing failed." : "Not drawn yet."}</p>
          {#if data.canDraw}
            <button type="button" class="btn btn-sm btn-outline nodrag" onclick={() => data.onDraw(data.screenKey)}>
              <Sparkles class="size-3.5" aria-hidden="true" />Draw this screen
            </button>
          {/if}
        {/if}
      </div>
    {/if}
    {#if cursor}
      {#if cursor.box && !data.live?.checking}
        <div class="live-box" style:transform="translate({cursor.box.x}px, {cursor.box.y}px)" style:width="{cursor.box.w}px" style:height="{cursor.box.h}px" aria-hidden="true"></div>
      {/if}
      <!-- The cursor keeps its size on screen whatever the zoom, like a collaborator's cursor. -->
      <div class="live-cursor" style:transform="translate({cursor.x}px, {cursor.y}px) scale({1 / Math.max(data.ui.zoom ?? 1, 0.1)})" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="18" height="18"><path d="M2 1.5 14 7.2l-5.2 1.5-2.3 5z" /></svg>
        <span>{data.live?.checking ? "Checking" : "Drawing"}</span>
      </div>
    {/if}
    {#if data.srcdoc && data.kind === "screen" && shown > data.frameHeight + 8}
      <div class="artboard-fold" style:top="{data.frameHeight}px" aria-hidden="true"><span>Fold · {data.frameHeight}</span></div>
    {/if}
  </div>
</div>

<style>
  .artboard {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .artboard-body {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    background: #fff;
    /* Flat, like every surface: a hairline, no drop shadow. */
    box-shadow: 0 0 0 1px var(--color-line);
  }
  /* The screen in focus: a primary-ink ring set off the frame. */
  .is-selected .artboard-body {
    box-shadow:
      0 0 0 4px var(--color-base-300),
      0 0 0 6px var(--color-primary-ink);
  }
  iframe {
    display: block;
    width: 100%;
    border: 0;
    background: #fff;
  }
  .artboard-fold {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--color-sky);
    pointer-events: none;
  }
  .artboard-fold span {
    position: absolute;
    right: 6px;
    top: 2px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--color-sky-soft);
    color: var(--color-sky);
    font: 500 12px/18px var(--font-sans);
  }
  /* The live drawing: an outline on the element being written and a cursor at its end. */
  .live-box,
  .live-cursor {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    transition:
      transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1),
      width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1),
      height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .live-box {
    border-radius: 4px;
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  }
  .live-cursor {
    display: flex;
    align-items: flex-start;
    z-index: 2;
    transform-origin: 0 0;
  }
  .live-cursor svg {
    fill: var(--color-primary);
    stroke: var(--color-primary-content);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .live-cursor span {
    margin-top: 14px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--color-primary);
    color: var(--color-primary-content);
    font: 600 11px/16px var(--font-sans);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .live-box,
    .live-cursor {
      transition: none;
    }
  }
  :global(.artboard-handle) {
    opacity: 0;
    pointer-events: none;
  }
</style>
