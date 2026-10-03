<script lang="ts">
  import Dropdown from "$lib/components/ui/Dropdown.svelte";
  import { ChevronDown, Columns2, Hand, Maximize, MessageSquare, Minus, Monitor, MousePointer2, PanelLeft, PanelRight, Plus, Smartphone, Tablet } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import { FRAMES, UX_DEVICES, isNative, type CanvasView, type FrameKey } from "$lib/ux-frames.js";
  import type { UxDevice, UxPlatform } from "$lib/types.js";

  /** The UI-reference canvas toolbar: tool, device, desktop frame size, colour mode, zoom, panel toggles and the page's own actions. */
  let {
    tool = $bindable(),
    device = $bindable(),
    theme = $bindable(),
    showLayers = $bindable(),
    showInspector = $bindable(),
    frame,
    platform = null,
    editing,
    styled,
    zoomPct,
    saving,
    actions,
    onFrame,
    onZoomIn,
    onZoomOut,
    onFit,
  }: {
    tool: "select" | "hand" | "comment";
    device: CanvasView;
    theme: "light" | "dark";
    showLayers: boolean;
    showInspector: boolean;
    frame: FrameKey;
    /** Absent = a web app (desktop presets + mobile); native mobile offers its own devices. */
    platform?: UxPlatform | null;
    editing: boolean;
    /** Whether the screens carry light and dark (styled kit screens, every open-design screen): offers the colour mode. */
    styled: boolean;
    zoomPct: number;
    saving: boolean;
    actions?: Snippet;
    onFrame: (frame: FrameKey) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
  } = $props();

  // Device, desktop frame size and colour mode are one decision — how the
  // screens are shown — so they share one "View" control that names the
  // current choice, instead of three groups in the row.
  let viewOpen = $state(false);
  const native = $derived(isNative(platform));
  // A native reference's devices, primary first; "All devices" shows them side by side.
  const nativeDevices = $derived<UxDevice[]>(native ? platform!.devices : []);
  const deviceIcon = (d: UxDevice) => (d === "phone" ? Smartphone : d === "desktop" ? Monitor : Tablet);
  // The native device on screen (the primary one when the view names another).
  const shown = $derived<UxDevice | null>(native ? (nativeDevices.includes(device as UxDevice) ? (device as UxDevice) : nativeDevices[0]!) : null);
  const deviceText = $derived(
    native
      ? device === "all"
        ? "All devices"
        : `${UX_DEVICES[shown!].label} ${UX_DEVICES[shown!].w}×${UX_DEVICES[shown!].h}`
      : device === "mobile"
        ? "Mobile"
        : device === "both"
          ? `${FRAMES[frame].label} + mobile`
          : `${FRAMES[frame].label} ${FRAMES[frame].w}×${FRAMES[frame].h}`,
  );
  const viewLabel = $derived(`${deviceText}${styled ? ` · ${theme === "light" ? "Light" : "Dark"}` : ""}`);
  const ViewIcon = $derived(native ? (device === "all" ? Columns2 : deviceIcon(shown!)) : device === "mobile" ? Smartphone : device === "both" ? Columns2 : Monitor);
</script>

<!-- One quiet row: panels and tools, then how the screens are shown and the zoom, then the page's actions. The canvas below is the hero. -->
<div class="flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-base-100 px-4 py-2">
  <div class="flex items-center gap-1.5">
    <button type="button" class="btn btn-ghost btn-sm btn-square hidden md:inline-flex" aria-label="Screens panel" aria-pressed={showLayers} title="Screens and layers" onclick={() => (showLayers = !showLayers)}>
      <PanelLeft class="size-4" aria-hidden="true" />
    </button>
    <div class="join" role="group" aria-label="Tool">
      <button type="button" class="btn btn-sm btn-square join-item {tool === 'select' ? 'btn-active' : ''}" aria-pressed={tool === "select"} title="Select (V)" onclick={() => (tool = "select")}><MousePointer2 class="size-4" aria-hidden="true" /><span class="sr-only">Select</span></button>
      <button type="button" class="btn btn-sm btn-square join-item {tool === 'hand' ? 'btn-active' : ''}" aria-pressed={tool === "hand"} title="Hand (H)" onclick={() => (tool = "hand")}><Hand class="size-4" aria-hidden="true" /><span class="sr-only">Hand</span></button>
      {#if editing}
        <button type="button" class="btn btn-sm btn-square join-item {tool === 'comment' ? 'btn-active' : ''}" aria-pressed={tool === "comment"} title="Comment (C)" onclick={() => (tool = "comment")}><MessageSquare class="size-4" aria-hidden="true" /><span class="sr-only">Comment</span></button>
      {/if}
    </div>
  </div>
  <span class="hidden h-6 w-px bg-line sm:block" aria-hidden="true"></span>
  <div class="flex items-center gap-1.5">
    <Dropdown bind:open={viewOpen} class="flex w-72 flex-col gap-3 rounded-box border border-line bg-base-100 p-3 text-[13px] shadow-xl">
      {#snippet trigger(props)}
        <button type="button" {...props} class="btn btn-sm gap-1.5 font-medium" aria-label={`View: ${viewLabel}`}>
          <ViewIcon class="size-4" aria-hidden="true" />
          <span class="max-w-[16rem] truncate">{viewLabel}</span>
          <ChevronDown class="size-3.5 text-base-content/75" aria-hidden="true" />
        </button>
      {/snippet}
      {#if native}
        <!-- An Android reference: its own devices (Android dp sizes); desktop presets don't apply. -->
        <div>
          <p class="mb-1.5 text-xs font-semibold text-base-content/80">Device</p>
          <div class="flex flex-col gap-1" role="group" aria-label="Device">
            {#each nativeDevices as d, i (d)}
              {@const Icon = deviceIcon(d)}
              <button type="button" class="btn btn-sm justify-start font-normal {device === d ? 'btn-active' : 'btn-ghost'}" aria-pressed={device === d} onclick={() => (device = d)}>
                <Icon class="size-3.5" aria-hidden="true" />{UX_DEVICES[d].label}
                <span class="ml-auto font-mono text-xs text-base-content/75">{UX_DEVICES[d].w}×{UX_DEVICES[d].h}{i === 0 ? " · primary" : ""}</span>
              </button>
            {/each}
            {#if nativeDevices.length > 1}
              <button type="button" class="btn btn-sm justify-start font-normal {device === 'all' ? 'btn-active' : 'btn-ghost'}" aria-pressed={device === "all"} onclick={() => (device = "all")}>
                <Columns2 class="size-3.5" aria-hidden="true" />All devices
              </button>
            {/if}
          </div>
        </div>
      {:else}
      <div>
        <p class="mb-1.5 text-xs font-semibold text-base-content/80">Device</p>
        <div class="join w-full" role="group" aria-label="Device">
          <button type="button" class="btn btn-sm join-item flex-1 {device === 'desktop' ? 'btn-active' : ''}" aria-pressed={device === "desktop"} onclick={() => (device = "desktop")}><Monitor class="size-3.5" aria-hidden="true" />Desktop</button>
          <button type="button" class="btn btn-sm join-item flex-1 {device === 'mobile' ? 'btn-active' : ''}" aria-pressed={device === "mobile"} onclick={() => (device = "mobile")}><Smartphone class="size-3.5" aria-hidden="true" />Mobile</button>
          <button type="button" class="btn btn-sm join-item flex-1 {device === 'both' ? 'btn-active' : ''}" aria-pressed={device === "both"} onclick={() => (device = "both")}><Columns2 class="size-3.5" aria-hidden="true" />Both</button>
        </div>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/80">Desktop frame</span>
        <select
          class="select select-sm w-full"
          disabled={device === "mobile"}
          value={frame}
          onchange={(e) => onFrame(e.currentTarget.value as FrameKey)}
        >
          {#each Object.entries(FRAMES) as [key, f] (key)}
            <option value={key}>{f.label} · {f.w}×{f.h}</option>
          {/each}
        </select>
      </label>
      {/if}
      {#if styled}
        <div>
          <p class="mb-1.5 text-xs font-semibold text-base-content/80">Colour mode</p>
          <div class="join w-full" role="group" aria-label="Colour mode">
            <button type="button" class="btn btn-sm join-item flex-1 {theme === 'light' ? 'btn-active' : ''}" aria-pressed={theme === "light"} onclick={() => (theme = "light")}>Light</button>
            <button type="button" class="btn btn-sm join-item flex-1 {theme === 'dark' ? 'btn-active' : ''}" aria-pressed={theme === "dark"} onclick={() => (theme = "dark")}>Dark</button>
          </div>
        </div>
      {/if}
    </Dropdown>
    <div class="join" role="group" aria-label="Zoom">
      <button type="button" class="btn btn-sm btn-square join-item" aria-label="Zoom out" title="Zoom out (-)" onclick={onZoomOut}><Minus class="size-4" aria-hidden="true" /></button>
      <span class="join-item flex h-8 w-14 items-center justify-center border-transparent bg-base-200 text-xs tabular-nums text-base-content/80">{zoomPct}%</span>
      <button type="button" class="btn btn-sm btn-square join-item" aria-label="Zoom in" title="Zoom in (+)" onclick={onZoomIn}><Plus class="size-4" aria-hidden="true" /></button>
      <button type="button" class="btn btn-sm btn-square join-item" aria-label="Fit everything" title="Fit everything (Shift+1)" onclick={onFit}><Maximize class="size-4" aria-hidden="true" /></button>
    </div>
    {#if saving}<span class="flex items-center gap-1.5 text-xs text-base-content/80" role="status"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Saving…</span>{/if}
  </div>
  <div class="ml-auto flex flex-wrap items-center gap-2">
    {#if actions}{@render actions()}{/if}
    <button type="button" class="btn btn-ghost btn-sm btn-square hidden md:inline-flex" aria-label="Inspector panel" aria-pressed={showInspector} title="Inspector" onclick={() => (showInspector = !showInspector)}>
      <PanelRight class="size-4" aria-hidden="true" />
    </button>
  </div>
</div>
