<script lang="ts">
  import Modal from "$lib/components/ui/Modal.svelte";
  import { ArrowLeft, Monitor, Smartphone, Tablet, X } from "lucide-svelte";
  import type { UxDevice, UxPlatform } from "$lib/types.js";
  import { UX_DEVICES, isNative, type BoardDevice } from "$lib/ux-frames.js";
  import { framedMockup } from "$lib/ux.js";
  import { canvasStyle, linkTarget, overlayDocs, triggerFor, type OverlayDoc } from "$lib/ux-canvas.js";

  /**
   * Click through the UI reference like a prototype: links between screens
   * (the shell navigation, content links, links set on the canvas) switch
   * screens; a button that opens a planned overlay shows that dialog or sheet;
   * any button inside an overlay closes it; a <summary> opens its <details>
   * (the phone menu). Nothing in the mockups runs — the player reads clicks
   * from the page side. It shows the colour mode the canvas shows.
   */
  let {
    open = $bindable(false),
    screens,
    startKey,
    theme,
    platform = null,
  }: {
    open: boolean;
    screens: Array<{ key: string; name: string; html: string | null }>;
    startKey: string | null;
    theme: "light" | "dark" | null;
    /** Absent = a web app (desktop / mobile); native mobile plays at its devices' sizes. */
    platform?: UxPlatform | null;
  } = $props();

  const native = $derived(isNative(platform));
  // Web: desktop or the 390 phone. Native: the reference's devices, primary first.
  const choices = $derived<BoardDevice[]>(native ? platform!.devices : ["desktop", "mobile"]);
  let device = $state<BoardDevice>("desktop");
  const size = $derived(device === "mobile" ? { w: 390, h: 844 } : device === "desktop" ? { w: 1280, h: 800 } : UX_DEVICES[device as UxDevice]);
  const deviceName = (d: BoardDevice) => (d === "mobile" ? "Mobile" : UX_DEVICES[d as UxDevice].label);
  const deviceIcon = (d: BoardDevice) => (d === "mobile" || d === "phone" ? Smartphone : d === "desktop" ? Monitor : Tablet);
  let current = $state<{ key: string; overlay: number | null } | null>(null);
  let trail = $state<Array<{ key: string; overlay: number | null }>>([]);

  const drawn = $derived(screens.filter((s) => s.html));
  const overlays = $derived(new Map(drawn.map((s) => [s.key, typeof DOMParser === "undefined" ? [] : overlayDocs(s.html!)])));

  $effect(() => {
    // Opens on the primary device; phones open on the phone-sized frame, as a bigger one would not fit.
    if (open && !current) {
      const small = typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches;
      device = small ? (native ? (choices.includes("phone") ? "phone" : choices[0]!) : "mobile") : choices[0]!;
    }
    if (open && !current) current = { key: startKey && drawn.some((s) => s.key === startKey) ? startKey : (drawn[0]?.key ?? ""), overlay: null };
    if (!open) {
      current = null;
      trail = [];
    }
  });

  const screen = $derived(current ? drawn.find((s) => s.key === current!.key) ?? null : null);
  const overlay = $derived<OverlayDoc | null>(current && current.overlay !== null ? (overlays.get(current.key)?.[current.overlay] ?? null) : null);
  const srcdoc = $derived(
    screen ? framedMockup(overlay ? overlay.html : screen.html!, theme ? { theme } : {}) : "",
  );

  function go(next: { key: string; overlay: number | null }) {
    if (current) trail = [...trail, current];
    current = next;
  }
  function back() {
    const prev = trail.at(-1);
    if (!prev) return;
    trail = trail.slice(0, -1);
    current = prev;
  }

  function wire(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;
    if (!doc || !current) return;
    const style = doc.createElement("style");
    style.textContent = canvasStyle({ hideOverlays: true }) + "\n[data-sdd-hot],summary{cursor:pointer !important}";
    doc.head.appendChild(style);
    const here = current;
    const list = overlays.get(here.key) ?? [];
    // Mark what can be clicked, so the prototype shows its hotspots.
    if (here.overlay === null) {
      for (const el of doc.querySelectorAll("a[href], [data-link]")) if (linkTarget(el)) el.setAttribute("data-sdd-hot", "");
      list.forEach((o) => triggerFor(doc, o.caption)?.setAttribute("data-sdd-hot", ""));
    }
    doc.addEventListener(
      "click",
      (e) => {
        const target = e.target as Element | null;
        if (!target) return;
        // A <summary> opens its <details> (the phone menu, a dropdown) as it
        // would in the product; nothing else in a mockup may act on its own
        // (links navigate the frame away, a form button submits it).
        const summary = target.closest("summary");
        if (!summary || summary.closest("a")) e.preventDefault();
        if (here.overlay !== null) {
          // Any button in a dialog or sheet closes it.
          if (!summary && target.closest("button, .ds-btn, .btn, a")) back();
          return;
        }
        const linked = target.closest("a[href], [data-link]");
        const to = linked ? linkTarget(linked) : null;
        if (to && drawn.some((s) => s.key === to) && to !== here.key) {
          e.preventDefault();
          go({ key: to, overlay: null });
          return;
        }
        const index = list.findIndex((o) => {
          const trigger = triggerFor(doc, o.caption);
          return trigger && (trigger === target || trigger.contains(target));
        });
        if (index >= 0) {
          e.preventDefault();
          go({ key: here.key, overlay: index });
        }
      },
      true,
    );
  }
</script>

<Modal bind:open labelledby="prototype-title" describedby="prototype-desc" boxClass="flex h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden rounded-none p-0">
  <div class="flex items-center gap-2 border-b border-line bg-base-100 px-3 py-2 max-sm:gap-1 max-sm:px-2">
    <button type="button" class="btn btn-ghost btn-sm max-sm:btn-square" onclick={back} disabled={!trail.length} aria-label="Back"><ArrowLeft class="size-4" aria-hidden="true" /><span class="max-sm:hidden">Back</span></button>
    <h2 id="prototype-title" class="min-w-0 flex-1 truncate text-[14px] font-semibold text-base-content">
      {screen?.name ?? "Prototype"}{#if overlay}<span class="font-normal text-base-content/80"> · {overlay.caption}</span>{/if}
    </h2>
    {#if choices.length > 1}
      <div class="join" role="group" aria-label="Device">
        {#each choices as d (d)}
          {@const Icon = deviceIcon(d)}
          <button type="button" class="btn btn-sm join-item {device === d ? 'btn-active' : ''}" aria-pressed={device === d} onclick={() => (device = d)}><Icon class="size-3.5" aria-hidden="true" /><span class="max-sm:sr-only">{deviceName(d)}</span></button>
        {/each}
      </div>
    {/if}
    <button type="button" onclick={() => (open = false)} class="btn btn-ghost btn-sm btn-square" aria-label="Close the prototype"><X class="size-4" /></button>
  </div>
  <p id="prototype-desc" class="sr-only">Click links and buttons in the screen to move through the UI reference.</p>
  <div class="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-base-300 p-4 max-sm:p-0">
    {#if screen}
      {#key srcdoc + device}
        <iframe
          title={`Prototype: ${screen.name}`}
          sandbox="allow-same-origin"
          {srcdoc}
          onload={(e) => wire(e.currentTarget as HTMLIFrameElement)}
          class="h-full rounded-box border-0 bg-white shadow-xl max-sm:rounded-none max-sm:shadow-none"
          style:width={`min(${size.w}px,100%)`}
          style:height={native ? `min(${size.h}px,100%)` : undefined}
        ></iframe>
      {/key}
    {/if}
  </div>
</Modal>
