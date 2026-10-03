<script lang="ts">
  import { browser } from "$app/environment";
  import { SvelteFlow, Background, MiniMap, MarkerType, getViewportForBounds, useSvelteFlow, type Edge, type Node, type NodeTypes } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import type { Snippet } from "svelte";
  import type { LayoutReference, UxComment, UxGenerator, UxPlatform, UxScreen } from "$lib/types.js";
  import { framedMockup, screenBase, type LiveDraw } from "$lib/ux.js";
  import { PART, canvasStyle, contentForSave, contentLinks, contentRoot, describe, layerTree, overlayDocs, textOf, triggerFor, type OverlayDoc } from "$lib/ux-canvas.js";
  import ArtboardNode, { type ArtboardData } from "./ArtboardNode.svelte";
  import LayersPanel from "./LayersPanel.svelte";
  import Inspector from "./Inspector.svelte";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import { boardDevices, boardSize, defaultView, saveFrame, savedFrame, type BoardDevice, type CanvasView, type FrameKey } from "$lib/ux-frames.js";
  import { untrack } from "svelte";

  /**
   * The UI-reference canvas (Figma/Stitch-like): every screen as an artboard
   * at its device width, each overlay as its own artboard under its screen,
   * arrows from the button that opens an overlay and from links between
   * screens. Elements are selected on the page side (the mockups cannot run
   * code); edits go to the screen's saved content and the server re-frames,
   * sanitizes and lints it.
   */
  let {
    projectId,
    screens,
    editing,
    styled,
    libraryName,
    components,
    generating,
    live,
    drawErrors,
    onDraw,
    onRedraw,
    onRemove,
    projectLayout = null,
    platform = null,
    generator = "kit",
    onScreenLayout,
    onSaved,
    onBusyChange,
    onThemeChange,
    actions,
  }: {
    projectId: string;
    screens: UxScreen[];
    editing: boolean;
    styled: boolean;
    libraryName: string | null;
    components: Record<string, string>;
    generating: string | null;
    /** The screen being drawn, as it arrives; its artboard shows it growing. */
    live?: LiveDraw;
    drawErrors: Record<string, string>;
    onDraw: (key: string) => void;
    onRedraw: (key: string, instruction: string) => Promise<boolean>;
    onRemove: (key: string) => void;
    /** The layout reference every screen follows unless it has its own. */
    projectLayout?: LayoutReference | null;
    /** What the screens are drawn as: absent = a web app; native mobile draws at its devices' sizes. */
    platform?: UxPlatform | null;
    /** How the screens are drawn: the ds-* kit in the platform's shell, or open-design documents (whole body, UX_OD_MARKERS). */
    generator?: UxGenerator;
    /** Open the layout reference of one screen (set, replace or remove its own). */
    onScreenLayout?: (key: string) => void;
    onSaved: () => Promise<void>;
    /** Whether a canvas request (an AI element edit, a save) is in flight — the page holds back "Plan again" and "Revise" meanwhile. */
    onBusyChange?: (busy: boolean) => void;
    /** The colour mode being previewed, so the prototype player shows the same one. */
    onThemeChange?: (theme: "light" | "dark") => void;
    actions?: Snippet;
  } = $props();

  /** The artboard title bar above each mockup (title row + gap). */
  const TITLE_H = 30;

  const flow = useSvelteFlow();
  const nodeTypes: NodeTypes = { artboard: ArtboardNode };

  let tool = $state<"select" | "hand" | "comment">("select");
  // Web opens on the desktop preset; a native reference on its primary device,
  // and again whenever the platform changes (a redraw as an Android app).
  let device = $state<CanvasView>(untrack(() => defaultView(platform)));
  const platformKey = $derived(platform ? `${platform.kind}:${platform.devices.join(",")}` : "web");
  let seenPlatform = untrack(() => platformKey);
  $effect(() => {
    if (platformKey === seenPlatform) return;
    seenPlatform = platformKey;
    device = defaultView(platform);
  });
  let frame = $state<FrameKey>(savedFrame());
  const sizeOf = (d: BoardDevice) => boardSize(d, frame);

  function setFrame(v: FrameKey) {
    frame = v;
    saveFrame(v);
    // Widths changed: bring the first screen back into view.
    setTimeout(() => fitTo(firstBoard ? [firstBoard] : null, { padding: 0.06, duration: 300, maxZoom: 0.9 }), 80);
  }
  let theme = $state<"light" | "dark">("light");
  let showLayers = $state(true);
  // The minimap sat on top of the artboards; it opens on request now.
  let showMap = $state(false);
  let showInspector = $state(true);
  // Below lg (tablets) the panels float over the canvas instead of beside it:
  // closed at first so the canvas stays usable, opened from the toolbar, and
  // the Inspector opens by itself on a selection or an error it has to show.
  // Until mounted they only show at lg, so a tablet never flashes them open.
  let wide = $state(true);
  let panelsReady = $state(false);
  $effect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    wide = mq.matches;
    if (!wide) {
      showLayers = false;
      showInspector = false;
    }
    panelsReady = true;
    const onChange = (e: MediaQueryListEvent) => (wide = e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });
  let heights = $state<Record<string, number>>({});
  let zoomPct = $state(100);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  $effect(() => {
    if (error && !wide) showInspector = true;
  });
  $effect(() => onBusyChange?.(busy !== null));
  $effect(() => onThemeChange?.(theme));

  /** Mockup documents by node id; not reactive — `docsTick` announces changes. */
  const docs = new Map<string, Document>();
  let docsTick = $state(0);
  let hovered: Element | null = null;
  let selection = $state<{ nodeId: string; nid: string | null; el: Element | null } | null>(null);
  let flowEl = $state<HTMLDivElement | null>(null);

  const drawn = $derived(screens.filter((s) => s.html));
  const overlayMap = $derived<Map<string, OverlayDoc[]>>(browser ? new Map(drawn.map((s) => [s.key, overlayDocs(s.html!)])) : new Map());
  const devices = $derived<BoardDevice[]>(boardDevices(device, platform));
  const primaryDevice = $derived(devices[0]!);
  const boardId = (key: string, d: BoardDevice) => `screen:${key}:${d}`;
  // The first screen: a lone screen opens on it, a frame change returns to it; Shift+1 fits everything.
  const firstBoard = $derived(screens[0] ? `screen:${screens[0].key}:${primaryDevice}` : null);
  const keyOf = (nodeId: string) => nodeId.split(":")[1]!;
  const screenOf = (nodeId: string | undefined) => (nodeId ? screens.find((s) => s.key === keyOf(nodeId)) ?? null : null);

  const od = $derived(generator === "od");

  function srcdocOf(html: string) {
    // Styled kit screens and every od screen carry light and dark tokens; pin the one being previewed.
    return framedMockup(html, styled || od ? { theme } : {});
  }

  function statusOf(s: UxScreen): ArtboardData["status"] {
    if (generating === s.key) return "drawing";
    if (drawErrors[s.key]) return "failed";
    return s.html ? "drawn" : "empty";
  }

  // Read through getters, so the artboards follow selection and tool without
  // an effect copying them over (and without rebuilding the nodes).
  const ui = {
    get selectedId() {
      return selection?.nodeId ?? null;
    },
    get interactive() {
      return tool !== "hand";
    },
    get zoom() {
      return zoomPct / 100;
    },
  };

  const common = () => ({
    ui,
    canDraw: editing && generating === null,
    live,
    onDoc,
    onDocGone,
    onHeight,
    onSelectBoard: selectBoard,
    onDraw,
  });

  let nodes = $state.raw<Node[]>([]);
  $effect(() => {
    const out: Node[] = [];
    let x = 0;
    for (const [index, s] of screens.entries()) {
      let dx = x;
      let tallest = 0;
      for (const d of devices) {
        const id = boardId(s.key, d);
        const size = sizeOf(d);
        const width = size.w;
        const data: ArtboardData = {
          ...common(),
          title: s.name,
          number: index + 1,
          subtitle: `${size.label} · ${size.w}×${size.h}`,
          // While drawing, the live frame (when the provider streams); the stored screen after.
          srcdoc: generating === s.key ? (live?.key === s.key && live.frame ? srcdocOf(live.frame) : null) : s.html ? srcdocOf(s.html) : null,
          width,
          frameHeight: size.h,
          kind: "screen",
          screenKey: s.key,
          status: statusOf(s),
        };
        out.push({ id, type: "artboard", position: { x: dx, y: 0 }, data, draggable: false, selectable: false });
        dx += width + 80;
        tallest = Math.max(tallest, heights[id] ?? size.h);
      }
      // Overlays open over the screen, so they are drawn at its viewport.
      const osize = sizeOf(primaryDevice);
      const ow = osize.w;
      let y = tallest + TITLE_H + 160;
      for (const o of overlayMap.get(s.key) ?? []) {
        const id = `overlay:${s.key}:${o.index}`;
        const data: ArtboardData = {
          ...common(),
          title: o.caption,
          subtitle: s.name,
          srcdoc: srcdocOf(o.html),
          width: ow,
          frameHeight: o.kind === "state" ? 360 : osize.h,
          kind: "overlay",
          screenKey: s.key,
          status: "drawn",
        };
        out.push({ id, type: "artboard", position: { x, y }, data, draggable: false, selectable: false });
        y += (heights[id] ?? osize.h) + TITLE_H + 90;
      }
      x = Math.max(dx, x + ow + 80) + 160;
    }
    nodes = out;
  });

  // Fit once, when the artboards first exist: later rebuilds (a screen drawn,
  // a height measured) must not move the viewport under the person. Several
  // screens open as an overview of all of them (reviewing starts with the
  // scope); a single screen fills the view.
  let fitted = false;
  $effect(() => {
    if (fitted || !nodes.length) return;
    fitted = true;
    setTimeout(() => fitTo(screens.length > 1 || !firstBoard ? null : [firstBoard], { padding: 0.06, maxZoom: 0.9 }), 60);
  });

  // The camera follows the drawing: each screen comes into view as its turn starts.
  $effect(() => {
    const key = generating;
    if (!key) return;
    const timer = setTimeout(() => fitTo([boardId(key, primaryDevice)], { padding: 0.08, duration: 600, maxZoom: 0.9 }), 120);
    return () => clearTimeout(timer);
  });

  let edges = $state.raw<Edge[]>([]);
  $effect(() => {
    void docsTick;
    const out: Edge[] = [];
    const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
    for (const s of drawn) {
      const source = boardId(s.key, primaryDevice);
      const doc = docs.get(source);
      if (!doc) continue;
      for (const o of overlayMap.get(s.key) ?? []) {
        const trigger = triggerFor(doc, o.caption);
        out.push({
          id: `open:${s.key}:${o.index}`,
          source,
          sourceHandle: "b",
          target: `overlay:${s.key}:${o.index}`,
          targetHandle: "t",
          type: "smoothstep",
          label: trigger ? textOf(trigger).slice(0, 40) : undefined,
          markerEnd: arrow,
          class: trigger ? "ux-edge-open" : "ux-edge-open ux-edge-loose",
        });
      }
      const seen = new Set<string>();
      for (const link of contentLinks(doc)) {
        if (link.target === s.key || seen.has(link.target) || !screens.some((x) => x.key === link.target)) continue;
        seen.add(link.target);
        out.push({
          id: `link:${s.key}:${link.target}`,
          source,
          sourceHandle: "r",
          target: boardId(link.target, primaryDevice),
          targetHandle: "l",
          type: "smoothstep",
          label: textOf(link.el).slice(0, 40),
          markerEnd: arrow,
          class: "ux-edge-link",
        });
      }
    }
    edges = out;
  });

  /* ── Mockup documents: outlines, selection, edits ── */

  function onHeight(id: string, h: number) {
    heights = { ...heights, [id]: h };
  }

  function pickable(e: Event): Element | null {
    let el = e.target as Element | null;
    if (!el || el.nodeType !== 1) return null;
    const svg = el.closest("svg");
    if (svg) el = svg;
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body" || el.matches(`main, ${PART.app}, ${PART.overlays}, ${PART.content}`)) return null;
    // The shell (the platform's, or the navigation an od screen copies from the platform) is not the screen's design content.
    if (el.closest(PART.shell)) return null;
    return el;
  }

  function onDoc(nodeId: string, doc: Document) {
    docs.set(nodeId, doc);
    const style = doc.createElement("style");
    style.textContent = canvasStyle({ hideOverlays: nodeId.startsWith("screen:") });
    doc.head.appendChild(style);
    doc.addEventListener("mouseover", (e) => hover(pickable(e)), true);
    doc.addEventListener("mouseleave", () => hover(null));
    doc.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element | null)?.closest?.('[contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        const el = pickable(e);
        if (el) pick(nodeId, el);
        else selectBoard(nodeId);
      },
      true,
    );
    doc.addEventListener(
      "dblclick",
      (e) => {
        // Inside the text being edited a double-click selects a word; starting
        // the edit again would reset the element and lose what was typed.
        if ((e.target as Element | null)?.closest?.('[contenteditable="true"]')) return;
        e.preventDefault();
        const el = pickable(e);
        if (!el) return;
        pick(nodeId, el);
        startTextEdit();
      },
      true,
    );
    doc.addEventListener("wheel", (e) => forwardWheel(e, doc), { passive: false });
    doc.addEventListener("keydown", (e) => onKey(e));
    // Details/summary would toggle open inside the canvas; keep mockups still.
    for (const d of doc.querySelectorAll("details")) d.addEventListener("toggle", () => d.removeAttribute("open"));
    drawPins(nodeId);
    if (selection?.nodeId === nodeId && selection.nid) {
      const el = doc.querySelector(`[data-nid="${selection.nid}"]`);
      if (el) {
        el.classList.add("sdd-selected");
        selection = { ...selection, el };
      }
    }
    docsTick++;
  }

  /** An artboard's document is gone (unmounted or reloading): forget it, so no edit reads it again. */
  function onDocGone(nodeId: string, doc: Document) {
    if (docs.get(nodeId) !== doc) return;
    docs.delete(nodeId);
    if (hovered?.ownerDocument === doc) hovered = null;
    // Keep the selected id: the reloaded mockup selects the element again (onDoc).
    if (selection?.el?.ownerDocument === doc) selection = { ...selection, el: null };
    docsTick++;
  }

  function hover(el: Element | null) {
    if (hovered && hovered !== el) hovered.classList.remove("sdd-hover");
    hovered = tool === "hand" ? null : el;
    if (hovered && hovered !== selection?.el) hovered.classList.add("sdd-hover");
  }

  function pick(nodeId: string, el: Element) {
    selection?.el?.classList.remove("sdd-selected");
    el.classList.remove("sdd-hover");
    el.classList.add("sdd-selected");
    selection = { nodeId, nid: el.getAttribute("data-nid"), el };
    error = null;
    if (!wide) showInspector = true;
    if (tool === "comment" && editing) setTimeout(() => (document.getElementById("comment-text") as HTMLTextAreaElement | null)?.focus(), 30);
  }

  function selectBoard(nodeId: string) {
    selection?.el?.classList.remove("sdd-selected");
    selection = { nodeId, nid: null, el: null };
    error = null;
  }

  function selectParent() {
    const el = selection?.el;
    if (!el || !selection) return;
    const parent = el.parentElement?.closest("[data-nid], .ds-card, .ds-section, .ds-modal, .ds-sheet");
    if (parent && !parent.matches(`main, ${PART.content}, ${PART.app}, ${PART.overlays}`)) pick(selection.nodeId, parent);
    else selectBoard(selection.nodeId);
  }

  /**
   * The screen's own document: edits made on an overlay artboard land in the
   * screen's content. Only a document still shown (its iframe in the page)
   * and showing the screen as it is now counts — a save builds the whole page
   * content from it, so an older copy would take back later changes.
   */
  function sourceDoc(key: string): Document | null {
    const screen = screens.find((s) => s.key === key);
    if (!screen?.html) return null;
    const current = srcdocOf(screen.html);
    for (const d of devices) {
      const doc = docs.get(boardId(key, d));
      const frame = doc?.defaultView?.frameElement;
      if (doc && frame?.isConnected && frame.getAttribute("srcdoc") === current) return doc;
    }
    return null;
  }

  /** Answers that mean the canvas is behind: the screen or the draft changed elsewhere. */
  const STALE = new Set(["UX_SCREEN_CHANGED", "UX_DRAFT_REPLACED"]);

  async function post(key: string, body: Record<string, unknown>, label: string, onResult?: (result: Record<string, unknown>) => void): Promise<boolean> {
    busy = label;
    error = null;
    try {
      const res = await fetch(`/projects/${projectId}/ux/screens/${encodeURIComponent(key)}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const answer = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        if (res.status === 409 && answer.code && STALE.has(answer.code)) {
          // Show what is stored now; the change was not applied.
          error = answer.code === "UX_DRAFT_REPLACED" ? (answer.message ?? "The draft was replaced — reloaded.") : "The screen changed — reloaded. Make the change again.";
          await onSaved();
          return false;
        }
        error = answer.message ?? "The change could not be saved.";
        return false;
      }
      onResult?.((await res.json().catch(() => ({}))) as Record<string, unknown>);
      await onSaved();
      return true;
    } catch {
      error = "The connection dropped. Try again.";
      return false;
    } finally {
      busy = null;
    }
  }

  /** Apply a change to the element with this id in the screen's source document, then save the content. */
  /** Change the selected element with AI; the new element is selected when the screen reloads. */
  async function aiElementEdit(instruction: string): Promise<boolean> {
    if (!selection?.nid) return false;
    const nodeId = selection.nodeId;
    let nid: string | null = null;
    const ok = await post(keyOf(nodeId), { op: "element", nid: selection.nid, instruction }, "element", (result) => {
      nid = typeof result.nid === "string" ? result.nid : null;
      selection?.el?.classList.remove("sdd-selected");
      selection = { nodeId, nid, el: null };
    });
    // Select it now if the page already shows it; a reloaded mockup selects it again by id.
    const el = ok && nid ? docs.get(nodeId)?.querySelector(`[data-nid="${nid}"]`) : null;
    if (el && selection?.nodeId === nodeId && !selection.el) pick(nodeId, el);
    return ok;
  }

  async function saveChange(key: string, nid: string | null, change: (el: Element) => void, note: string) {
    const screen = screens.find((s) => s.key === key);
    const doc = sourceDoc(key);
    if (!screen || !doc) {
      // No shown copy of the current screen (it is reloading, or its artboard
      // is not on the canvas): refuse rather than save from an older copy.
      error = "The screen is reloading — make the change again in a moment.";
      return;
    }
    const el = nid ? doc.querySelector(`[data-nid="${nid}"]`) : null;
    if (!el) {
      error = "This element can't be edited here — redraw the screen and try again.";
      return;
    }
    change(el);
    await post(key, { op: "content", content: contentForSave(doc, { od }), note, base: screenBase(screen) }, "save");
  }

  function startTextEdit() {
    const sel = selection;
    const el = sel?.el as HTMLElement | null;
    if (!sel || !el || !editing || !describe(el).textEditable) return;
    const original = el.innerHTML;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "false");
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const s = el.ownerDocument.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    let cancelled = false;
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelled = true;
        el.innerHTML = original;
        el.blur();
      }
      e.stopPropagation();
    };
    el.addEventListener("keydown", keys);
    el.addEventListener(
      "blur",
      () => {
        el.removeEventListener("keydown", keys);
        el.removeAttribute("contenteditable");
        el.removeAttribute("spellcheck");
        const html = el.innerHTML;
        if (cancelled || html === original) return;
        const text = textOf(el).slice(0, 60);
        void saveChange(keyOf(sel.nodeId), sel.nid, (target) => (target.innerHTML = html), `Edited text: "${text}"`);
      },
      { once: true },
    );
  }

  function link(target: string | null) {
    const sel = selection;
    if (!sel?.el) return;
    const key = keyOf(sel.nodeId);
    const name = screens.find((s) => s.key === target)?.name ?? "";
    void saveChange(
      key,
      sel.nid,
      (el) => {
        if (target) el.setAttribute("data-link", target);
        else el.removeAttribute("data-link");
        if (el.tagName.toLowerCase() === "a") {
          if (target) el.setAttribute("href", `./${target}.html`);
          else el.removeAttribute("href");
        }
      },
      target ? `Linked "${textOf(sel.el).slice(0, 40)}" to ${name}` : `Removed the link on "${textOf(sel.el).slice(0, 40)}"`,
    );
  }

  function comment(text: string) {
    const sel = selection;
    if (!sel?.el || !sel.nid) return;
    const info = describe(sel.el);
    void post(keyOf(sel.nodeId), { op: "comment", nid: sel.nid, anchor: info.text ? `${info.role}: ${info.text.slice(0, 80)}` : info.role, text }, "comment");
  }

  function commentUpdate(c: UxComment, action: "resolve" | "reopen" | "delete") {
    const key = selection ? keyOf(selection.nodeId) : null;
    if (key) void post(key, { op: "comment-update", commentId: c.id, action }, "comment");
  }

  function focusComment(c: UxComment) {
    if (!selection || !c.nid) return;
    const key = keyOf(selection.nodeId);
    const id = boardId(key, primaryDevice);
    const el = docs.get(id)?.querySelector(`[data-nid="${c.nid}"]`);
    if (el) {
      pick(id, el);
      centerOn(id, el);
    }
  }

  /* ── Comment pins: numbered markers inside the mockups ── */

  function drawPins(nodeId: string) {
    const doc = docs.get(nodeId);
    const s = screenOf(nodeId);
    if (!doc || !s) return;
    doc.querySelectorAll(".sdd-pin").forEach((p) => p.remove());
    const win = doc.defaultView;
    (s.comments ?? []).forEach((c, i) => {
      const el = c.nid ? doc.querySelector(`[data-nid="${c.nid}"]`) : null;
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.width === 0) return;
      const pin = doc.createElement("span");
      pin.className = `sdd-pin${c.resolved_at ? " sdd-pin-resolved" : ""}`;
      pin.textContent = String(i + 1);
      pin.style.left = `${r.left + (win?.scrollX ?? 0) - 8}px`;
      pin.style.top = `${r.top + (win?.scrollY ?? 0) - 12}px`;
      doc.body.appendChild(pin);
    });
  }
  $effect(() => {
    void screens;
    void docsTick;
    for (const id of docs.keys()) drawPins(id);
  });

  /* ── Viewport ── */

  function forwardWheel(e: WheelEvent, doc: Document) {
    e.preventDefault();
    const vp = flow.getViewport();
    if (e.ctrlKey || e.metaKey) {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      const box = flowEl?.getBoundingClientRect();
      if (!frame || !box) return;
      const px = frame.left + e.clientX * vp.zoom - box.left;
      const py = frame.top + e.clientY * vp.zoom - box.top;
      const zoom = Math.min(2, Math.max(0.05, vp.zoom * Math.exp(-e.deltaY * 0.002)));
      void flow.setViewport({ x: px - (px - vp.x) * (zoom / vp.zoom), y: py - (py - vp.y) * (zoom / vp.zoom), zoom });
    } else {
      void flow.setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY, zoom: vp.zoom });
    }
  }

  /**
   * Fit the viewport to some artboards (all when none are given), from their
   * known sizes. Not flow.fitView: with a duration it stays queued until its
   * animation ends, and an animation cut short (a scroll or zoom meanwhile)
   * left it queued for good — every later node update (Esc, the hand tool, a
   * new height) zoomed back into that artboard. The viewport is computed from
   * the canvas container's own size; while the canvas is not laid out yet (no
   * size, no pan-zoom) it tries again, or a fit at size 0 zoomed to the
   * minimum and the artboards vanished off screen.
   */
  function fitTo(ids: string[] | null, opts: { padding?: number; duration?: number; maxZoom?: number } = {}, tries = 20) {
    const list = ids ? nodes.filter((n) => ids.includes(n.id)) : nodes;
    if (!list.length) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of list) {
      const d = n.data as ArtboardData;
      x1 = Math.min(x1, n.position.x);
      y1 = Math.min(y1, n.position.y);
      x2 = Math.max(x2, n.position.x + d.width);
      y2 = Math.max(y2, n.position.y + TITLE_H + (heights[n.id] ?? d.frameHeight));
    }
    const retry = () => {
      if (tries > 0) setTimeout(() => fitTo(ids, opts, tries - 1), 100);
    };
    const w = flowEl?.clientWidth ?? 0;
    const h = flowEl?.clientHeight ?? 0;
    if (w < 50 || h < 50) return retry();
    const vp = getViewportForBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, w, h, 0.05, opts.maxZoom ?? 2, opts.padding ?? 0.1);
    void flow.setViewport(vp, { duration: opts.duration }).then((ok) => {
      if (!ok) retry();
    });
  }

  /**
   * Zoom by a factor around the middle of the canvas. Not flow.zoomIn/zoomOut:
   * in @xyflow/svelte 1.7 useSvelteFlow() hands out the store's zoomIn/zoomOut
   * from before the canvas mounted, bound to a store with no pan-zoom yet, so
   * they always resolved false and the buttons and keys did nothing.
   */
  // Where the running zoom animation ends: a second click builds on it, not on a frame halfway there.
  let zoomTarget: { x: number; y: number; zoom: number } | null = null;
  function zoomBy(factor: number) {
    const vp = zoomTarget ?? flow.getViewport();
    const w = flowEl?.clientWidth ?? 0;
    const h = flowEl?.clientHeight ?? 0;
    const zoom = Math.min(2, Math.max(0.05, vp.zoom * factor));
    if (!w || !h || zoom === vp.zoom) return;
    const cx = w / 2;
    const cy = h / 2;
    const next = { x: cx - (cx - vp.x) * (zoom / vp.zoom), y: cy - (cy - vp.y) * (zoom / vp.zoom), zoom };
    zoomTarget = next;
    void flow.setViewport(next, { duration: 150 }).finally(() => {
      if (zoomTarget === next) zoomTarget = null;
    });
  }

  function centerOn(nodeId: string, el: Element | null) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (!el) {
      fitTo([nodeId], { duration: 400, padding: 0.15 });
      return;
    }
    const r = el.getBoundingClientRect();
    const win = el.ownerDocument.defaultView;
    const zoom = Math.max(flow.getViewport().zoom, 0.7);
    void flow.setCenter(node.position.x + r.left + (win?.scrollX ?? 0) + r.width / 2, node.position.y + TITLE_H + r.top + (win?.scrollY ?? 0) + r.height / 2, { zoom, duration: 400 });
  }

  /** Controls of the page itself whose own keys (Enter, Space, letters) must not also drive the canvas. */
  const OWN_KEYS = 'input, textarea, select, option, button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"]';
  /** An open dialog (Add screen, Plan again, Play) owns the keyboard. */
  const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

  // Keyboard travel: [ and ] step through the artboards (selected and
  // centred, announced), the arrow keys pan (Shift for a bigger step).
  let announce = $state("");
  function stepBoard(dir: 1 | -1) {
    if (boards.length === 0) return;
    const i = boards.findIndex((b) => b.id === selection?.nodeId);
    const next = boards[i === -1 ? (dir === 1 ? 0 : boards.length - 1) : (i + dir + boards.length) % boards.length]!;
    selectBoard(next.id);
    centerOn(next.id, null);
    announce = `${next.title} — ${boards.indexOf(next) + 1} of ${boards.length}`;
  }
  function panBy(dx: number, dy: number) {
    const vp = flow.getViewport();
    void flow.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 100 });
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && t.isContentEditable) return;
    if (document.querySelector(DIALOG)) return;
    // Page controls only: inside a mockup nothing is live, and a focused
    // mockup button is just the element last clicked on the canvas.
    if (t?.ownerDocument === document && t.closest?.(`${OWN_KEYS}, ${DIALOG}`)) return;
    if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "v") tool = "select";
    else if (k === "h") tool = "hand";
    else if (k === "c" && editing) tool = "comment";
    else if (e.key === "Escape") selection?.el ? selectParent() : (selection = null);
    else if (e.key === "!" || (e.shiftKey && k === "1")) fitTo(null, { duration: 300 });
    else if (k === "+" || k === "=") zoomBy(1.2);
    else if (k === "-") zoomBy(1 / 1.2);
    else if (k === "enter" && selection?.el) startTextEdit();
    else if (e.key === "]") stepBoard(1);
    else if (e.key === "[") stepBoard(-1);
    else if (e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? 240 : 80;
      panBy(e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0, e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0);
    } else return;
    e.preventDefault();
  }

  /* ── Panels ── */

  const boards = $derived(
    nodes.map((n) => {
      const d = n.data as ArtboardData;
      const s = screens.find((x) => x.key === d.screenKey);
      return {
        id: n.id,
        title: d.kind === "overlay" ? d.title : `${d.title} · ${d.subtitle.split(" · ")[0]}`,
        subtitle: d.subtitle,
        kind: d.kind,
        n: screens.findIndex((x) => x.key === d.screenKey) + 1,
        label: d.title,
        // The device only tells two boards of one screen apart.
        device: d.kind === "screen" && devices.length > 1 ? d.subtitle.split(" · ")[0]! : null,
        comments: d.kind === "screen" ? (s?.comments ?? []).filter((c) => !c.resolved_at).length : 0,
      };
    }),
  );
  const tree = $derived.by(() => {
    void docsTick;
    const id = selection?.nodeId;
    const doc = id ? docs.get(id) : null;
    const root = doc ? (doc.querySelector("[data-overlay]") ?? contentRoot(doc)) : null;
    return root ? layerTree(root) : [];
  });
  const info = $derived(selection?.el ? describe(selection.el) : null);
  const selectedScreen = $derived(screenOf(selection?.nodeId));
  const boardLabel = $derived(boards.find((b) => b.id === selection?.nodeId)?.title ?? "");

  $effect(() => {
    // Hand tool: the mockups stop taking the pointer, so the whole canvas drags.
    if (tool === "hand") hover(null);
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="flex h-full min-h-0 flex-col">
  <CanvasToolbar
    bind:tool
    bind:device
    bind:theme
    bind:showLayers
    bind:showInspector
    {frame}
    {platform}
    {editing}
    styled={styled || od}
    {zoomPct}
    saving={busy !== null}
    {actions}
    onFrame={setFrame}
    onZoomIn={() => zoomBy(1.2)}
    onZoomOut={() => zoomBy(1 / 1.2)}
    onFit={() => fitTo(null, { duration: 300 })}
  />

  <div class="relative flex min-h-0 flex-1">
    {#if showLayers}
      <aside
        class="hidden w-56 shrink-0 border-r border-line bg-base-100 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:shadow-lg {panelsReady ? 'md:block' : 'lg:block'}"
        aria-label="Screens and layers"
      >
        <LayersPanel
          {boards}
          focusedBoard={selection?.nodeId ?? null}
          {tree}
          selectedEl={selection?.el ?? null}
          onPickBoard={(id) => { selectBoard(id); centerOn(id, null); }}
          onPickLayer={(el) => { if (selection) { pick(selection.nodeId, el); centerOn(selection.nodeId, el); } }}
        />
      </aside>
    {/if}

    <!-- Focusable so keyboard users land on the canvas: [ ] step through the screens, arrows pan, + and - zoom. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="ux-flow relative min-w-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      bind:this={flowEl}
      class:tool-hand={tool === "hand"}
      role="region"
      aria-label="Canvas. Press ] and [ to move between screens, the arrow keys to pan, + and - to zoom."
      tabindex="0"
    >
      <p class="sr-only" aria-live="polite">{announce}</p>
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        minZoom={0.05}
        maxZoom={2}
        panOnScroll
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onpaneclick={() => { selection?.el?.classList.remove("sdd-selected"); selection = null; }}
        onmove={(_e, vp) => (zoomPct = Math.round(vp.zoom * 100))}
      >
        <Background gap={24} />
        {#if showMap}<MiniMap pannable zoomable class="hidden md:block" />{/if}
      </SvelteFlow>
      <button
        type="button"
        class="btn btn-sm btn-ghost absolute right-3 z-10 hidden border-line bg-base-100 font-medium text-base-content/80 md:inline-flex {showMap ? 'bottom-[170px]' : 'bottom-4'}"
        aria-pressed={showMap}
        onclick={() => (showMap = !showMap)}
      >
        {showMap ? "Hide map" : "Show map"}
      </button>
    </div>

    {#if showInspector}
      <aside
        class="hidden w-[296px] shrink-0 border-l border-line bg-base-100 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-lg {panelsReady ? 'md:block' : 'lg:block'}"
        aria-label="Inspector"
      >
        <Inspector
          {editing}
          screen={selectedScreen}
          {boardLabel}
          {info}
          {libraryName}
          {components}
          screens={screens.map((s) => ({ key: s.key, name: s.name }))}
          busy={busy ?? (generating ? "redraw" : null)}
          {error}
          onEditText={startTextEdit}
          onLink={link}
          onComment={comment}
          onCommentUpdate={commentUpdate}
          onFocusComment={focusComment}
          onSelectParent={selectParent}
          onUndo={() => selectedScreen && post(selectedScreen.key, { op: "undo", base: screenBase(selectedScreen) }, "undo")}
          onRestore={(index) => {
            // The version is named by its time: an index alone could name another one once the history moved.
            const at = selectedScreen?.history?.[index]?.at;
            if (selectedScreen && at) void post(selectedScreen.key, { op: "restore", index, at, base: screenBase(selectedScreen) }, "restore");
          }}
          onCheck={() => selectedScreen && post(selectedScreen.key, { op: "check" }, "check")}
          onAiEdit={aiElementEdit}
          onRedraw={(instruction) => selectedScreen && onRedraw(selectedScreen.key, instruction)}
          onDraw={() => selectedScreen && onDraw(selectedScreen.key)}
          onClear={() => selectedScreen && post(selectedScreen.key, { op: "clear", base: screenBase(selectedScreen) }, "clear")}
          onReview={(aspects) => (selectedScreen ? post(selectedScreen.key, { op: "review", aspects, base: screenBase(selectedScreen) }, "review") : Promise.resolve(false))}
          onRemove={() => { if (selectedScreen) { selection = null; onRemove(selectedScreen.key); } }}
          {projectLayout}
          onLayout={onScreenLayout && selectedScreen ? () => selectedScreen && onScreenLayout(selectedScreen.key) : undefined}
        />
      </aside>
    {/if}
  </div>
</div>

<style>
  .ux-flow :global(.svelte-flow) {
    /* The canvas is a well (base-300) under quiet base-100 panels: the screens are the hero. */
    --xy-background-color: var(--color-base-300);
    --xy-background-pattern-color: var(--color-line);
    --xy-edge-stroke: color-mix(in oklab, var(--color-base-content) 80%, var(--color-base-100));
    --xy-edge-label-background-color: var(--color-base-100);
    --xy-edge-label-color: var(--color-base-content);
    --xy-minimap-background-color: var(--color-base-100);
  }
  /* Flow labels at the app's 12px floor, not xyflow's 10px default. */
  .ux-flow :global(.svelte-flow__edge-label),
  .ux-flow :global(.svelte-flow__edge-text) {
    font-size: 12px;
  }
  .ux-flow :global(.ux-edge-open path) {
    stroke: var(--color-sky);
  }
  .ux-flow :global(.ux-edge-loose path) {
    stroke-dasharray: 6 6;
  }
  .ux-flow :global(.svelte-flow__node) {
    cursor: default;
  }
  .tool-hand :global(.svelte-flow__pane),
  .tool-hand :global(.svelte-flow__node) {
    cursor: grab;
  }
</style>
