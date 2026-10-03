<script lang="ts">
  import { deserialize, enhance } from "$app/forms";
  import { invalidate } from "$app/navigation";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Dropdown from "$lib/components/ui/Dropdown.svelte";
  import { Bell, CircleAlert, CircleCheck, Compass, Database, Ellipsis, LayoutTemplate, Lock, Monitor, Paintbrush, PencilLine, Play, Plus, RefreshCw, Smartphone, Sparkles, Type, X } from "lucide-svelte";
  import { untrack } from "svelte";
  import type { LayoutReference, UxDevice, UxPlatform, UxScreen, UxState } from "$lib/types.js";
  import { UX_DEVICES, isNative, platformDiffers, platformLabel } from "$lib/ux-frames.js";
  import DecisionReceipt from "$lib/components/DecisionReceipt.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import UxCanvas from "$lib/components/ux/UxCanvas.svelte";
  import PrototypePlayer from "$lib/components/ux/PrototypePlayer.svelte";
  import LayoutReferenceDialog from "$lib/components/ux/LayoutReferenceDialog.svelte";
  import LayoutReferenceSummary from "$lib/components/ux/LayoutReferenceSummary.svelte";
  import BriefDialog from "$lib/components/ux/BriefDialog.svelte";
  import { blocksApproval, layoutStale, readEvents, scopeToConfirm, screenBase, type LiveDraw } from "$lib/ux.js";

  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; key: string; name: string };
      ux: UxState;
      aiAvailable: boolean;
      designSystem: { name: string; version: number } | null;
      library: { name: string; components: Record<string, string> } | null;
    };
    form: { ok?: boolean; notice?: string; message?: string; addError?: string; restyled?: boolean } | null;
  } = $props();

  const p = $derived(data.project.id);
  // The draft is what is being worked on; the approved version is what agents use.
  const view = $derived(data.ux.draft ?? data.ux.approved);
  const editing = $derived(Boolean(data.ux.draft));
  const ref = $derived(view?.reference ?? null);
  const screens = $derived<UxScreen[]>(ref?.applicable ? ref.screens : []);
  const ready = $derived(screens.filter((s) => s.html).length);
  const complete = $derived(screens.length > 0 && ready === screens.length);
  const styled = $derived(ref?.fidelity === "styled");
  const templateLook = $derived(ref?.layout_reference?.mode === "adapt" ? ref.layout_reference.design_system : null);
  // Open-design screens (whole documents, UX_OD_MARKERS) carry light and dark tokens in either fidelity.
  const od = $derived(ref?.generator === "od");
  // Drawn screens are necessary, not enough: findings that block approval must be fixed and left-out scope confirmed.
  const screenBlockers = $derived(screens.reduce((n, s) => n + (s.lint ?? []).filter(blocksApproval).length, 0));
  const confirmScope = $derived(editing && scopeToConfirm(ref));
  let confirming = $state(false);

  let planning = $state(false);
  let generating = $state<string | null>(null);
  let queue = $state<string[]>([]);
  // The screen being drawn, as it arrives (providers that stream; others show a spinner).
  const live = $state<LiveDraw>({ key: null, frame: null, content: "", checking: false });
  function watch(key: string | null) {
    live.key = key;
    live.frame = null;
    live.content = "";
    live.checking = false;
  }
  let errors = $state<Record<string, string>>({});
  let notice = $state<string | null>(null);

  // Mirrors MAX_UX_SCREENS in @sdd/contracts: each screen is its own AI call.
  const MAX_SCREENS = 12;
  let countMode = $state<"auto" | "set">("auto");
  // Styled by default once a design system is approved.
  let fidelity = $state<"neutral" | "styled">(untrack(() => (data.designSystem ? "styled" : "neutral")));
  let screenCount = $state(4);
  let addOpen = $state(false);
  let addBusy = $state(false);
  let planOpen = $state(false);
  let playOpen = $state(false);
  let moreOpen = $state(false);
  // Changing the look keeps the plan: a new draft with every drawing cleared, then drawn again.
  let lookOpen = $state(false);
  let restyling = $state(false);
  let lookFidelity = $state<"neutral" | "styled">("styled");
  let lookHintHidden = $state(false);
  // Phones get a screen list instead of the canvas; a row plays from its screen.
  let playStart = $state<string | null>(null);
  function playFrom(key: string | null) {
    playStart = key;
    playOpen = true;
  }
  // A canvas request in flight (an AI element edit, a save): planning again or
  // revising meanwhile would replace the draft it is about to land in.
  let canvasBusy = $state(false);
  // The colour mode previewed on the canvas; Play shows the same one.
  let canvasTheme = $state<"light" | "dark">("light");
  const plural = (n: number) => `${n} screen${n === 1 ? "" : "s"}`;

  async function refresh() {
    // The reference and the project's next step both change.
    await Promise.all([invalidate("app:ux"), invalidate("app:journey")]);
  }

  async function generate(key: string, change?: string): Promise<boolean> {
    generating = key;
    watch(key);
    const { [key]: _, ...rest } = errors;
    errors = rest;
    const fail = (message: string) => {
      errors = { ...errors, [key]: message };
      return false;
    };
    try {
      const res = await fetch(`/projects/${p}/ux/screens/${encodeURIComponent(key)}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change ? { instruction: change } : {}),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return fail(body.message ?? "This screen could not be generated. Try again.");
      }
      let outcome: { ok: true } | { message: string } | null = null;
      await readEvents(res.body, (event, payload) => {
        const d = payload as { html?: string; message?: string };
        if (event === "frame" && typeof d.html === "string") live.frame = d.html;
        else if (event === "content" && typeof d.html === "string") live.content = d.html;
        else if (event === "phase") live.checking = true;
        else if (event === "done") outcome = { ok: true };
        else if (event === "error") outcome = { message: d.message ?? "This screen could not be generated. Try again." };
      });
      const result = outcome as { ok: true } | { message: string } | null;
      if (!result) return fail("The connection dropped while generating. Try again.");
      if ("message" in result) return fail(result.message);
      await refresh();
      return true;
    } catch {
      return fail("The connection dropped while generating. Try again.");
    } finally {
      generating = null;
      watch(null);
    }
  }

  async function generateMissing() {
    queue = screens.filter((s) => !s.html).map((s) => s.key);
    while (queue.length) {
      const ok = await generate(queue[0]!);
      queue = queue.slice(1);
      if (!ok) {
        queue = [];
        break;
      }
    }
  }

  async function removeScreen(key: string) {
    const body = new FormData();
    body.set("screenKey", key);
    const res = await fetch("?/removeScreen", { method: "POST", headers: { accept: "application/json" }, body });
    const result = deserialize(await res.text()) as { type: string; data?: { message?: string; notice?: string } };
    if (result.type === "success") notice = result.data?.notice ?? "Screen removed.";
    else errors = { ...errors, [key]: result.data?.message ?? "The screen could not be removed." };
    await refresh();
  }

  // ── Layout reference: the person's own page the screens follow for layout.
  // Before a plan it rides along with the plan form (undefined = keep the
  // draft's own); on the canvas it is stored on the draft or on one screen.
  let planLayoutChoice = $state<LayoutReference | null | undefined>(undefined);
  const planLayout = $derived(planLayoutChoice === undefined ? (ref?.layout_reference ?? null) : planLayoutChoice);
  type LayoutScope = { kind: "plan" } | { kind: "draft" } | { kind: "screen"; key: string; name: string };
  let layoutScope = $state<LayoutScope>({ kind: "plan" });
  let layoutOpen = $state(false);
  let layoutSource = $state<"builtin" | "own">("builtin");
  function openLayout(scope: LayoutScope, source: "builtin" | "own" = "builtin") {
    layoutScope = scope;
    layoutSource = source;
    layoutOpen = true;
  }
  const layoutScreen = $derived(layoutScope.kind === "screen" ? screens.find((s) => s.key === (layoutScope as { key: string }).key) : undefined);
  const layoutCurrent = $derived(
    layoutScope.kind === "plan" ? planLayout : layoutScope.kind === "draft" ? (ref?.layout_reference ?? null) : (layoutScreen?.layout_reference ?? null),
  );
  async function layoutRequest(body: Record<string, unknown>): Promise<string | null> {
    try {
      const res = await fetch(`/projects/${p}/ux/layout-reference`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const answer = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return answer.message ?? "The layout reference could not be saved. Try again.";
      await refresh();
      return null;
    } catch {
      return "The connection dropped. Try again.";
    }
  }
  const screenScope = () => (layoutScreen ? { screenKey: layoutScreen.key, ...(layoutScreen.html ? { base: screenBase(layoutScreen) } : {}) } : {});
  async function useLayout(reference: LayoutReference): Promise<string | null> {
    if (layoutScope.kind === "plan") {
      planLayoutChoice = reference;
      if (reference.mode === "adapt" && reference.design_system) fidelity = "styled";
      return null;
    }
    return layoutRequest({ op: "use", reference, ...(layoutScope.kind === "screen" ? screenScope() : {}) });
  }
  async function removeLayout(): Promise<string | null> {
    if (layoutScope.kind === "plan") {
      planLayoutChoice = null;
      return null;
    }
    return layoutRequest({ op: "remove", ...(layoutScope.kind === "screen" ? screenScope() : {}) });
  }
  // Drawn before the layout reference they should follow changed: redraw to follow it.
  const layoutOutdated = $derived(editing && ref ? screens.filter((s) => layoutStale(ref, s)).map((s) => s.key) : []);
  async function redrawOutdated() {
    queue = [...layoutOutdated];
    while (queue.length) {
      const ok = await generate(queue[0]!);
      queue = queue.slice(1);
      if (!ok) {
        queue = [];
        break;
      }
    }
  }

  // ── Platform: what the screens are drawn as. The API reads it from the
  // approved stack and the requirements; the person may change it in the plan
  // form or in "Change look". A reference without one was drawn as a web app.
  const detected = $derived<UxPlatform | null>(data.ux.detected_platform ?? null);
  const drawnAs = $derived<UxPlatform | null>(ref?.platform ?? null);
  const NATIVE_DEVICES: UxDevice[] = ["tablet-landscape", "phone", "tablet-portrait"];
  /** A platform the person picked: web, or Android with its devices (primary first). */
  function chosenPlatform(kind: "web" | "native-mobile", devices: UxDevice[]): UxPlatform {
    return kind === "web"
      ? { kind: "web", os: null, devices: ["desktop"], source: "user", reason: "Chosen by you" }
      : { kind: "native-mobile", os: "android", devices: devices.length ? devices : ["phone"], source: "user", reason: "Chosen by you" };
  }
  // Android devices to start from: the detected ones when the detection is native, else tablet + phone.
  const nativeStart = $derived<UxDevice[]>(isNative(detected) ? detected.devices : ["tablet-landscape", "phone"]);

  // Plan form: the detection, unless the person changed it.
  let planPlatformChoice = $state<UxPlatform | null>(null);
  let platformEditing = $state(false);
  const planPlatform = $derived(planPlatformChoice ?? detected);
  let editKind = $state<"web" | "native-mobile">("web");
  let editDevices = $state<UxDevice[]>([]);
  function startPlatformEdit() {
    editKind = isNative(planPlatform) ? "native-mobile" : "web";
    editDevices = isNative(planPlatform) ? [...planPlatform.devices] : [...nativeStart];
    platformEditing = true;
  }
  function toggleDevice(d: UxDevice) {
    editDevices = editDevices.includes(d) ? editDevices.filter((x) => x !== d) : [...editDevices, d];
  }
  function makePrimary(d: UxDevice) {
    editDevices = [d, ...editDevices.filter((x) => x !== d)];
  }
  function applyPlatformEdit() {
    const next = chosenPlatform(editKind, editDevices);
    // Back to the detection when the choice is what was detected.
    const same = detected && !platformDiffers(next, detected) && next.devices.join() === detected.devices.join();
    planPlatformChoice = same ? null : next;
    platformEditing = false;
  }

  // Drawn as another platform than the stack and requirements call for: offer a redraw that keeps the plan.
  let platformHintHidden = $state(false);
  const platformMismatch = $derived(Boolean(view && ref?.applicable && screens.length && detected && platformDiffers(drawnAs, detected) && !platformHintHidden));
  const mismatchText = $derived.by(() => {
    if (!detected) return "";
    // The reason is a sentence of its own; inside the brackets it loses its full stop.
    const from = (detected.reason || "from the stack").replace(/\.\s*$/, "");
    if (isNative(detected) && !isNative(drawnAs)) return `These screens were drawn as a web app, but the stack is a native Android app (${from}). Redraw them as an Android app; the plan stays.`;
    if (!isNative(detected) && isNative(drawnAs)) return `These screens were drawn as an Android app, but the stack is a web app (${from}). Redraw them as a web app; the plan stays.`;
    const was = drawnAs?.devices[0] ? UX_DEVICES[drawnAs.devices[0]].label : "another device";
    return `These screens were drawn for ${was} first; the requirements point to ${UX_DEVICES[detected.devices[0]!].label}. Redraw them for it; the plan stays.`;
  });

  // Change look: the platform can change with it (null = keep the one drawn).
  let lookKind = $state<"web" | "native-mobile">("web");
  const lookPlatform = $derived.by<UxPlatform | null>(() => {
    if (lookKind === (isNative(drawnAs) ? "native-mobile" : "web")) return null;
    if (lookKind === "native-mobile") return isNative(detected) ? detected : chosenPlatform("native-mobile", nativeStart);
    return detected && !isNative(detected) ? detected : chosenPlatform("web", []);
  });

  const failed = $derived(Object.entries(errors));
  // Neutral screens while a design system is approved: offer to draw them with it, keeping the plan.
  const offerStyled = $derived(Boolean(view && ref?.applicable && screens.length && !styled && data.designSystem && !lookHintHidden));
  // How the screens are drawn: plain greys, or the approved design system.
  const lookLabel = $derived(styled ? `${data.designSystem?.name ?? "Design system"} v${ref?.design_system_version ?? "?"}` : "Neutral greys");

  // ── Product brief (aturan.md §4): what the screens are designed for; the plan's guesses are listed to review.
  let briefOpen = $state(false);
  let briefHintHidden = $state(false);
  const brief = $derived(ref?.brief ?? null);
  const briefToReview = $derived(brief && brief.source === "ai" ? brief.assumptions.length : 0);
  const showBriefHint = $derived(Boolean(editing && ref?.applicable && briefToReview > 0 && !briefHintHidden));

  // How a web shell navigates (absent on older references: the side navigation); native apps use their own chrome.
  const SHELL_LAYOUT_LABEL = { sidebar: "Side navigation", topnav: "Top navigation", minimal: "Minimal shell" } as const;
  const shellLabel = $derived(ref && !isNative(drawnAs) ? SHELL_LAYOUT_LABEL[ref.shell?.layout ?? "sidebar"] : null);

  // Styled mockups embed no fonts: say which font is really shown when the design system's isn't.
  let fontHintHidden = $state(false);
  const fontNote = $derived.by(() => {
    const f = data.ux.fonts;
    if (!f?.fallback || !styled || fontHintHidden) return null;
    const requested = f.requested.filter(Boolean);
    return `Shown in ${f.shown} — ${requested.length ? requested.join(", ") : "the design system's font"} ${requested.length > 1 ? "aren't" : "isn't"} embedded in mockups.`;
  });
  const approvedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const notificationCount = $derived([platformMismatch && detected, showBriefHint, fontNote, layoutOutdated.length, offerStyled && data.designSystem, editing && complete && screenBlockers > 0, editing && data.ux.approved].filter(Boolean).length);
</script>

<svelte:head>
  <title>UI reference — {data.project.name}</title>
</svelte:head>

{#snippet restyleForm(fidelity: "neutral" | "styled", label: string, btnClass: string, platform: UxPlatform | null = null)}
  <!-- Keeps every screen and its plan; the drawings are cleared and drawn again with the new look. -->
  <form
    method="post"
    action="?/restyle"
    use:enhance={() => {
      restyling = true;
      return async ({ result, update }) => {
        restyling = false;
        await update({ reset: false });
        if (result.type === "success") {
          lookOpen = false;
          await generateMissing();
        }
      };
    }}
  >
    <input type="hidden" name="fidelity" value={fidelity} />
    {#if platform}<input type="hidden" name="platform" value={JSON.stringify(platform)} />{/if}
    <button class={btnClass} type="submit" disabled={restyling || planning || generating !== null || canvasBusy || !data.aiAvailable} aria-busy={restyling}>
      {#if restyling}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else if platform && isNative(platform)}<Smartphone class="size-4" aria-hidden="true" />{:else if platform}<Monitor class="size-4" aria-hidden="true" />{:else}<Paintbrush class="size-4" aria-hidden="true" />{/if}{label}
    </button>
  </form>
{/snippet}

{#snippet planForm(label: string)}
  <form
    method="post"
    action="?/plan"
    class="flex flex-col gap-4 text-left"
    use:enhance={() => {
      planning = true;
      return async ({ result, update }) => {
        planning = false;
        if (result.type === "success") planOpen = false;
        // Keep the choices: the radios are bound to state, a form reset would blank them.
        await update({ reset: false });
      };
    }}
  >
    <input type="hidden" name="mode" value="plan" />
    <!-- What the screens are drawn as: read from the stack and the requirements; the person may change it. -->
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-base-content/80">Platform</span>
      {#if planPlatformChoice}<input type="hidden" name="platform" value={JSON.stringify(planPlatformChoice)} />{/if}
      {#if !platformEditing}
        <div class="flex items-start justify-between gap-3 rounded-box border border-line bg-base-100 p-3 text-[13px]">
          <span class="flex min-w-0 items-start gap-2.5">
            {#if isNative(planPlatform)}<Smartphone class="mt-0.5 size-4 shrink-0 text-base-content/80" aria-hidden="true" />{:else}<Monitor class="mt-0.5 size-4 shrink-0 text-base-content/80" aria-hidden="true" />{/if}
            <span class="min-w-0">
              <span class="font-medium text-base-content">{isNative(planPlatform) ? `Android app · ${planPlatform.devices.map((d) => UX_DEVICES[d].label).join(", ")}` : "Web app"}</span>
              <span class="block text-base-content/80">
                {#if planPlatformChoice}Chosen by you.{#if detected}{" "}Detected: {platformLabel(detected)}.{/if}{:else if planPlatform?.reason}{planPlatform.reason}{:else}Read from the stack and the requirements.{/if}
              </span>
            </span>
          </span>
          <span class="flex shrink-0 gap-1">
            {#if planPlatformChoice}<button type="button" class="btn btn-ghost btn-xs" onclick={() => (planPlatformChoice = null)}>Use detected</button>{/if}
            <button type="button" class="btn btn-ghost btn-xs" onclick={startPlatformEdit}>Change</button>
          </span>
        </div>
      {:else}
        <div class="flex flex-col gap-2 rounded-box border border-line bg-base-100 p-3 text-[13px]">
          <div class="join w-full" role="group" aria-label="Platform">
            <button type="button" class="btn btn-sm join-item flex-1 {editKind === 'web' ? 'btn-active' : ''}" aria-pressed={editKind === "web"} onclick={() => (editKind = "web")}><Monitor class="size-3.5" aria-hidden="true" />Web app</button>
            <button type="button" class="btn btn-sm join-item flex-1 {editKind === 'native-mobile' ? 'btn-active' : ''}" aria-pressed={editKind === "native-mobile"} onclick={() => (editKind = "native-mobile")}><Smartphone class="size-3.5" aria-hidden="true" />Android app</button>
          </div>
          {#if editKind === "native-mobile"}
            <fieldset class="flex flex-col gap-1">
              <legend class="mb-1 text-xs text-base-content/80">Devices. The first is primary: the canvas opens on it and it leads the layout.</legend>
              {#each NATIVE_DEVICES as d (d)}
                {@const on = editDevices.includes(d)}
                <div class="flex min-h-9 items-center gap-2">
                  <label class="flex grow cursor-pointer items-center gap-2">
                    <input type="checkbox" class="checkbox checkbox-sm" checked={on} onchange={() => toggleDevice(d)} />
                    <span>{UX_DEVICES[d].label} <span class="font-mono text-xs text-base-content/75">{UX_DEVICES[d].w}×{UX_DEVICES[d].h}</span></span>
                  </label>
                  {#if on && editDevices[0] === d}
                    <span class="badge badge-sm border-line bg-base-200 text-base-content/80">Primary</span>
                  {:else if on}
                    <button type="button" class="btn btn-ghost btn-xs" onclick={() => makePrimary(d)}>Make primary</button>
                  {/if}
                </div>
              {/each}
            </fieldset>
          {/if}
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => (platformEditing = false)}>Cancel</button>
            <button type="button" class="btn btn-sm btn-outline" onclick={applyPlatformEdit} disabled={editKind === "native-mobile" && editDevices.length === 0}>Use this</button>
          </div>
        </div>
      {/if}
    </div>
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1.5 text-xs font-semibold text-base-content/80">Look</legend>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:disabled]:cursor-default has-[:enabled]:hover:bg-base-200">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" name="fidelity" value="neutral" bind:group={fidelity} />
        <span>
          <span class="font-medium text-base-content">Neutral greys</span>
          <span class="block text-base-content/80">Layout, content and flow only.</span>
        </span>
      </label>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:disabled]:cursor-default has-[:enabled]:hover:bg-base-200 {data.designSystem || (planLayout?.mode === 'adapt' && planLayout.design_system) ? '' : 'opacity-70'}">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" name="fidelity" value="styled" bind:group={fidelity} disabled={!data.designSystem && !(planLayout?.mode === "adapt" && planLayout.design_system)} />
        <span>
          <span class="font-medium text-base-content">{planLayout?.mode === "adapt" && planLayout.design_system ? `Template appearance — ${planLayout.name}` : `Design system${data.designSystem ? ` — ${data.designSystem.name}` : ""}`}</span>
          <span class="block text-base-content/80">
            {#if planLayout?.mode === "adapt" && planLayout.design_system}
              Colours, typography and structure derived from the selected template.
            {:else if data.designSystem}
              Real colours and type, light and dark.
            {:else}
              Approve a <a class="font-medium text-base-content underline underline-offset-2" href={`/projects/${data.project.id}/design-system`}>design system</a> first.
            {/if}
          </span>
        </span>
      </label>
    </fieldset>
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1.5 text-xs font-semibold text-base-content/80">Screens</legend>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:disabled]:cursor-default has-[:enabled]:hover:bg-base-200">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" name="countMode" value="auto" bind:group={countMode} />
        <span>
          <span class="font-medium text-base-content">AI recommends</span>
          <span class="block text-base-content/80">Usually 4 to 8, with the reason.</span>
        </span>
      </label>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:disabled]:cursor-default has-[:enabled]:hover:bg-base-200">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" name="countMode" value="set" bind:group={countMode} />
        <span class="font-medium text-base-content">Set a number</span>
      </label>
      {#if countMode === "set"}
        <div class="ml-3 flex flex-wrap items-center gap-2">
          <input class="input w-20" type="number" name="screenCount" min="1" max={MAX_SCREENS} required aria-label="Number of screens" bind:value={screenCount} />
          <span class="text-[13px] text-base-content/80">1 to {MAX_SCREENS}</span>
        </div>
      {/if}
    </fieldset>
    <!-- A page to follow for layout: screens keep their own content and look. -->
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-base-content/80">Drawing method</span>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" class="btn btn-sm {planLayout ? 'btn-outline' : 'btn-active'}" aria-pressed={!planLayout} onclick={() => (planLayoutChoice = null)}>Draw sendiri</button>
        <button type="button" class="btn btn-sm btn-outline" onclick={() => openLayout({ kind: "plan" }, "builtin")} disabled={!data.aiAvailable}>Draw with template</button>
        <button type="button" class="btn btn-sm btn-outline" onclick={() => openLayout({ kind: "plan" }, "own")} disabled={!data.aiAvailable}>Draw with your own template</button>
      </div>
      {#if planLayout}
        <input type="hidden" name="layoutReference" value={JSON.stringify(planLayout)} />
        <div class="flex items-start justify-between gap-3 rounded-box border border-line bg-base-100 p-3">
          <LayoutReferenceSummary reference={planLayout} />
          <div class="flex shrink-0 gap-1">
            <button type="button" class="btn btn-ghost btn-xs" onclick={() => openLayout({ kind: "plan" })}>Replace</button>
            <button type="button" class="btn btn-ghost btn-xs" onclick={() => (planLayoutChoice = null)}>Remove</button>
          </div>
        </div>
      {:else}
        <p class="text-xs text-base-content/75">AI draws from your requirements and design system, without a template.</p>
      {/if}
    </div>
    <label class="flex flex-col gap-1.5 text-xs font-semibold text-base-content/80">
      <span>Include or leave out <span class="font-normal text-base-content/75">Optional</span></span>
      <textarea class="textarea min-h-[72px] w-full resize-y text-[13px] font-normal" name="guidance" maxlength="1000" placeholder="e.g. Include the admin dashboard; leave out account settings"></textarea>
    </label>
    <div class="flex justify-start">
      <button class="btn btn-primary" type="submit" disabled={planning || !data.aiAvailable || generating !== null || canvasBusy} aria-busy={planning}>
        {#if planning}Planning screens…{:else}<Sparkles class="size-4" aria-hidden="true" />{label}{/if}
      </button>
    </div>
    <AiProgress active={planning} label="Planning the screens" estimate="about a minute" />
  </form>
{/snippet}

{#if !view || data.ux.stale || (ref && !ref.applicable)}
  <!-- Nothing to show on a canvas yet: explain, offer the plan, make skipping obvious. -->
  <main class="mx-auto w-full max-w-[640px] px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
    <h1 class="text-[28px] font-extrabold tracking-tight sm:text-[32px]">UI reference</h1>
    <p class="mt-1 text-[14px] text-base-content/80">Optional. Sketch the key screens before building.</p>
    {#if form?.message}<Notice tone="error" class="mt-4">{form.message}</Notice>{/if}
    {#if data.ux.stale && data.ux.stale_plan}
      <Notice tone="warn" class="mt-4">The design system changed, so these drawings are out of date. The screens themselves still fit.</Notice>
    {:else if data.ux.stale}
      <Notice tone="warn" class="mt-4">The requirements or design changed, so this reference no longer applies. Plan it again.</Notice>
    {/if}
    {#if !data.aiAvailable}
      <Notice tone="info" class="mt-4">
        Needs an AI provider. <a class="font-medium underline underline-offset-2" href="/settings/ai">Connect one</a> or skip this step.
      </Notice>
    {/if}
    {#if data.ux.stale && data.ux.stale_plan}
      {@const kept = data.ux.stale_plan}
      <section class="card mt-6 border border-line bg-base-100 p-5 sm:p-6" aria-labelledby="ux-keep-title">
        <div class="mb-4 flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-field border border-line bg-base-200"><Paintbrush class="size-4" aria-hidden="true" /></span>
          <div class="min-w-0">
            <h2 id="ux-keep-title" class="text-[16px] font-semibold">Keep the {plural(kept.screens)}, draw them again</h2>
            <p class="mt-0.5 text-[13px] text-base-content/80">Their plan, example data and comments carry over from v{kept.version}. Only the drawings are made again.</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          {#if data.designSystem}
            {@render restyleForm("styled", `Redraw with ${data.designSystem.name} v${data.designSystem.version}`, "btn btn-primary")}
          {/if}
          {@render restyleForm("neutral", "Redraw in neutral greys", data.designSystem ? "btn btn-outline" : "btn btn-primary")}
        </div>
      </section>
    {/if}
    <section class="card mt-6 border border-line bg-base-100 p-5 sm:p-6" aria-labelledby="ux-plan-title">
      <div class="mb-5 flex items-start gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-field border border-line bg-base-200"><Monitor class="size-4" aria-hidden="true" /></span>
        <div class="min-w-0">
          {#if ref && !ref.applicable}
            <h2 id="ux-plan-title" class="text-[16px] font-semibold">No screens to draw</h2>
            <p class="mt-0.5 text-[13px] text-base-content/80">{ref.reason || "This product has no user interface."}</p>
          {:else}
            <h2 id="ux-plan-title" class="text-[16px] font-semibold">Plan the screens</h2>
            <p class="mt-0.5 text-[13px] text-base-content/80">Review them on a canvas, then approve.</p>
          {/if}
        </div>
      </div>
      {@render planForm(ref && !ref.applicable ? "Plan again" : "Plan the screens")}
    </section>
  </main>
{:else}
  {#snippet actions()}
    <div class="flex flex-wrap items-center gap-2 text-xs">
      {#if editing}
        <span class="badge badge-sm gap-1 border-line bg-base-200 text-base-content/80"><PencilLine class="size-3" aria-hidden="true" />Draft v{view.version}</span>
      {:else}
        <span class="badge badge-sm gap-1 border-mint/40 bg-mint-soft text-mint" title={view.approved_at ? `Approved ${approvedFormat.format(new Date(view.approved_at))}` : undefined}><Lock class="size-3" aria-hidden="true" />Approved v{view.version}</span>
      {/if}
      <span class="hidden text-base-content/75 lg:inline" title="What the screens are drawn as">{platformLabel(drawnAs)}{#if shellLabel}{" "}· {shellLabel}{/if}</span>
      {#if brief}
        <button type="button" class="btn btn-ghost btn-xs hidden gap-1 lg:inline-flex" onclick={() => (briefOpen = true)} title="Who the screens are designed for, the visual direction and what dominates">
          <Compass class="size-3.5" aria-hidden="true" />Brief{#if briefToReview}<span class="badge badge-xs border-warn/40 bg-warn-soft text-warn">{briefToReview}</span>{/if}
        </button>
      {/if}
      <span class="hidden text-base-content/75 2xl:inline">{lookLabel}</span>
      {#if editing}
        {#if ref?.plan_lint?.length}
          <!-- What the plan check found (a busy screen, requirements with no screen): plan again to act on it. -->
          <details class="dropdown dropdown-end">
            <summary class="badge badge-sm cursor-pointer list-none gap-1 {ref.plan_lint.some(blocksApproval) ? 'border-danger/40 bg-danger-soft text-danger' : 'border-warn/40 bg-warn-soft text-warn'}">
              <CircleAlert class="size-3" aria-hidden="true" />{ref.plan_lint.length} plan note{ref.plan_lint.length === 1 ? "" : "s"}
            </summary>
            <div class="dropdown-content z-30 mt-1 w-80 rounded-box border border-line bg-base-100 p-3 text-[13px] shadow-lg">
              <ul class="flex flex-col gap-1.5">
                {#each ref.plan_lint as f (f.rule)}<li class="flex gap-1.5 {blocksApproval(f) ? 'text-danger' : 'text-base-content/80'}"><CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{#if blocksApproval(f)}<span class="font-semibold">Blocks approval: </span>{/if}{f.message}</span></li>{/each}
              </ul>
              <p class="mt-2 text-xs text-base-content/75">Plan again to apply them, or add a screen for a missing requirement.</p>
            </div>
          </details>
        {/if}
        {#if ref?.sample_data && (ref.sample_data.records.length || ref.sample_data.people.length)}
          <!-- The records, people and numbers every screen is drawn with. -->
          <details class="dropdown dropdown-end">
            <summary class="btn btn-ghost btn-sm btn-square list-none" aria-label="Example data" title="Example data"><Database class="size-4" aria-hidden="true" /></summary>
            <div class="dropdown-content z-30 mt-1 max-h-[70vh] w-96 overflow-y-auto rounded-box border border-line bg-base-100 p-3 text-[13px] shadow-lg">
              <p class="font-semibold text-base-content">Example data</p>
              <p class="text-xs text-base-content/75">Every screen shows these records and people.</p>
              {#if ref.sample_data.records.length}
                <ul class="mt-2 flex flex-col gap-1.5">
                  {#each ref.sample_data.records as r (r.kind + r.name)}
                    <li><span class="text-xs text-base-content/75">{r.kind}</span> <span class="font-semibold text-base-content">{r.name}</span>{#if r.facts}<span class="block text-xs text-base-content/80">{r.facts}</span>{/if}</li>
                  {/each}
                </ul>
              {/if}
              {#if ref.sample_data.people.length}
                <p class="mt-2 text-xs font-semibold text-base-content/80">People</p>
                <p class="text-xs text-base-content">{ref.sample_data.people.map((p) => `${p.name} (${p.role})`).join(" · ")}</p>
              {/if}
              {#if ref.sample_data.statuses?.length}
                <p class="mt-2 text-xs font-semibold text-base-content/80">Status colours</p>
                <p class="mt-1 flex flex-wrap gap-1">
                  {#each ref.sample_data.statuses as st (st.label)}
                    <span class="badge badge-sm {st.tone === 'success' ? 'badge-success' : st.tone === 'warn' ? 'badge-warning' : st.tone === 'danger' ? 'badge-error' : st.tone === 'info' ? 'badge-info' : st.tone === 'accent' ? 'badge-primary' : ''} badge-soft">{st.label}</span>
                  {/each}
                </p>
              {/if}
              {#if ref.sample_data.notes}<p class="mt-2 text-xs text-base-content/80">{ref.sample_data.notes}</p>{/if}
            </div>
          </details>
        {/if}
        <span class="sr-only text-base-content/80 2xl:not-sr-only" aria-live="polite">
          {#if queue.length}Drawing {screens.length - queue.length + 1} of {screens.length}…{:else}{ready} of {screens.length} drawn{/if}
        </span>
        <!-- Adding and re-planning are occasional: one quiet menu. -->
        <Dropdown bind:open={moreOpen} align="end" class="w-60 rounded-box border border-line bg-base-100 p-1.5 text-[13px] shadow-xl">
          {#snippet trigger(props)}
            <button type="button" {...props} class="btn btn-ghost btn-sm btn-square" aria-label="More actions" title="More actions"><Ellipsis class="size-4" aria-hidden="true" /></button>
          {/snippet}
          <p class="px-3 pb-1 pt-1.5 text-xs text-base-content/75">{platformLabel(drawnAs)}{#if shellLabel}{" "}· {shellLabel}{/if} · {lookLabel}</p>
          <ul class="menu w-full p-0">
            <li>
              <button type="button" onclick={() => { moreOpen = false; addOpen = true; }} disabled={screens.length >= MAX_SCREENS || generating !== null} class={screens.length >= MAX_SCREENS || generating !== null ? "menu-disabled" : ""}>
                <Plus class="size-4" aria-hidden="true" />Add screen
              </button>
            </li>
            <li>
              <button type="button" onclick={() => { moreOpen = false; planOpen = true; }} disabled={generating !== null || canvasBusy} class={generating !== null || canvasBusy ? "menu-disabled" : ""}>
                <RefreshCw class="size-4" aria-hidden="true" />Plan again
              </button>
            </li>
            <li>
              <button type="button" onclick={() => { moreOpen = false; briefOpen = true; }}>
                <Compass class="size-4" aria-hidden="true" />Product brief{#if briefToReview}<span class="ml-auto text-xs text-warn">{briefToReview} to review</span>{/if}
              </button>
            </li>
            <li>
              <button type="button" onclick={() => { moreOpen = false; openLayout({ kind: "draft" }); }} disabled={generating !== null || canvasBusy} class={generating !== null || canvasBusy ? "menu-disabled" : ""}>
                <LayoutTemplate class="size-4" aria-hidden="true" />Draw with template{#if ref?.layout_reference}<span class="ml-auto max-w-24 truncate text-xs text-base-content/75">{ref.layout_reference.name}</span>{/if}
              </button>
            </li>
            <li>
              <button type="button" onclick={() => { moreOpen = false; lookFidelity = styled || !data.designSystem ? "neutral" : "styled"; lookKind = isNative(drawnAs) ? "native-mobile" : "web"; lookOpen = true; }} disabled={generating !== null || canvasBusy} class={generating !== null || canvasBusy ? "menu-disabled" : ""}>
                <Paintbrush class="size-4" aria-hidden="true" />Change look
              </button>
            </li>
          </ul>
        </Dropdown>
      {:else if view.approved_at}
        <span class="hidden text-base-content/75 2xl:inline">{approvedFormat.format(new Date(view.approved_at))}</span>
      {/if}
    </div>
    <button type="button" class="btn btn-sm btn-outline" onclick={() => playFrom(null)} disabled={ready === 0}><Play class="size-3.5" aria-hidden="true" />Play</button>
    {#if editing}
      {#if !complete}
        <button class="btn btn-primary" type="button" onclick={generateMissing} disabled={generating !== null}>
          {#if queue.length}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Sparkles class="size-4" aria-hidden="true" />{/if}
          {ready === 0 ? "Draw all screens" : `Draw ${screens.length - ready} remaining`}
        </button>
      {:else}
        <DecisionReceipt
          kind="ux"
          version={view.version}
          replaces={data.ux.approved?.version ?? null}
          summary={`${screens.length} screens`}
          action="?/approve"
          fields={{ revisionId: view.revision_id }}
          label={`Approve v${view.version}`}
          disabled={generating !== null || screenBlockers > 0 || confirmScope}
          title={screenBlockers > 0
            ? `${screenBlockers} finding${screenBlockers === 1 ? "" : "s"} on the screens block approval — select a screen to see and fix them`
            : confirmScope
              ? "Confirm the scope the plan leaves out first"
              : undefined}
        />
      {/if}
    {:else}
      <form method="post" action="?/plan" use:enhance={() => { planning = true; return async ({ update }) => { planning = false; await update(); }; }}>
        <input type="hidden" name="mode" value="revise" />
        <button class="btn btn-primary" type="submit" disabled={planning || generating !== null || canvasBusy}>
          {#if planning}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<PencilLine class="size-4" aria-hidden="true" />{/if}Revise
        </button>
      </form>
    {/if}
  {/snippet}

  <!-- The canvas fills everything under the app header and the project tabs. -->
  <main class="flex flex-col md:h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-3.5rem)] md:min-h-[480px]">
    {#if notificationCount || form?.message || notice || form?.notice || failed.length || confirmScope}
      <div class="flex flex-col gap-1.5 border-b border-line bg-base-100 px-4 py-2 text-[13px]">
        {#if notificationCount}
          <details class="collapse collapse-arrow rounded-box border border-line" data-ux-notifications>
            <summary class="collapse-title flex min-h-11 items-center gap-2 py-2 text-[13px] font-medium">
              <Bell class="size-4 shrink-0" aria-hidden="true" />Notifications
              <span class="badge badge-sm">{notificationCount}</span>
              {#if editing && complete && screenBlockers > 0}<span class="badge badge-sm badge-error">{screenBlockers} blocking</span>{/if}
            </summary>
            <div class="collapse-content flex flex-col gap-3 text-[13px]">
        {#if platformMismatch && detected}
          <!-- Drawn as another platform than the stack calls for: redraw, keeping the plan. -->
          <div class="flex flex-wrap items-center gap-2 text-warn" role="status">
            {#if isNative(detected)}<Smartphone class="size-3.5 shrink-0" aria-hidden="true" />{:else}<Monitor class="size-3.5 shrink-0" aria-hidden="true" />{/if}
            <span>{mismatchText}</span>
            {@render restyleForm(styled ? "styled" : "neutral", isNative(detected) ? "Redraw as Android app" : "Redraw as web app", "btn btn-sm btn-outline", detected)}
            <button type="button" class="btn btn-ghost btn-xs" aria-label="Keep the current platform" title="Keep the current platform" onclick={() => (platformHintHidden = true)}><X class="size-3" /></button>
          </div>
        {/if}
        {#if showBriefHint}
          <!-- The plan wrote the brief from the requirements; what it guessed is worth a look before drawing. -->
          <div class="flex flex-wrap items-center gap-2 text-base-content/80" role="status">
            <Compass class="size-3.5 shrink-0" aria-hidden="true" />
            <span>Product brief: the plan assumed {briefToReview === 1 ? "one thing" : `${briefToReview} things`} the requirements don't say{#if brief?.direction}{" "}— “{brief.direction.length > 90 ? `${brief.direction.slice(0, 90)}…` : brief.direction}”{/if}.</span>
            <button type="button" class="btn btn-sm btn-outline" onclick={() => (briefOpen = true)}>Review brief</button>
            <button type="button" class="btn btn-ghost btn-xs" aria-label="Hide for now" title="Hide for now" onclick={() => (briefHintHidden = true)}><X class="size-3" /></button>
          </div>
        {/if}
        {#if fontNote}
          <div class="flex flex-wrap items-center gap-2 text-base-content/80" role="status">
            <Type class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{fontNote}</span>
            <button type="button" class="btn btn-ghost btn-xs" aria-label="Dismiss" title="Dismiss" onclick={() => (fontHintHidden = true)}><X class="size-3" /></button>
          </div>
        {/if}
        {#if layoutOutdated.length}
          <div class="flex flex-wrap items-center gap-2 text-base-content/80" role="status">
            <LayoutTemplate class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{layoutOutdated.length === 1 ? "One screen was" : `${layoutOutdated.length} screens were`} drawn before the layout reference changed — redraw to follow it.</span>
            <button type="button" class="btn btn-sm btn-outline" onclick={redrawOutdated} disabled={generating !== null || canvasBusy || !data.aiAvailable}>
              {#if queue.length && generating}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}Redraw {plural(layoutOutdated.length)}
            </button>
          </div>
        {/if}
        {#if offerStyled && data.designSystem}
          <div class="flex flex-wrap items-center gap-2 text-base-content/80" role="status">
            <Paintbrush class="size-3.5 shrink-0" aria-hidden="true" />
            <span>Drawn in neutral greys. {data.designSystem.name} is approved: redraw the {plural(screens.length)} with it, the plan stays.</span>
            {@render restyleForm("styled", `Redraw with ${data.designSystem.name}`, "btn btn-sm btn-outline")}
            <button type="button" class="btn btn-ghost btn-xs" aria-label="Keep neutral greys" title="Keep neutral greys" onclick={() => (lookHintHidden = true)}><X class="size-3" /></button>
          </div>
        {/if}
        {#if editing && complete && screenBlockers > 0}
          <p class="flex items-center gap-2 text-danger" role="status"><CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />{screenBlockers === 1 ? "One finding blocks" : `${screenBlockers} findings block`} approval — select a screen to fix it.</p>
        {/if}
        {#if editing && data.ux.approved}<p class="text-base-content/75">v{data.ux.approved.version} stays in use until you approve this draft.</p>{/if}
            </div>
          </details>
        {/if}
        {#if confirmScope && ref}
          <!-- The plan could not serve everything within the requested count or the screen limit: the person decides. -->
          <div class="flex flex-wrap items-center gap-2 text-warn" role="status">
            <CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {#if ref.count_conflict?.uncovered.length}At {plural(ref.requested_count ?? screens.length)}, {ref.count_conflict.uncovered.join(", ")} {ref.count_conflict.uncovered.length === 1 ? "has" : "have"} no screen{#if ref.count_conflict.minimum_count} — at least {plural(ref.count_conflict.minimum_count)} would serve {ref.count_conflict.uncovered.length === 1 ? "it" : "them"}{/if}.{/if}
              {#if ref.uncovered_scope?.length} Left out beyond the screen limit: {ref.uncovered_scope.join("; ")}.{/if}
            </span>
            <form method="post" action="?/confirmScope" use:enhance={() => { confirming = true; return async ({ update }) => { confirming = false; await update(); }; }}>
              <button class="btn btn-sm btn-outline" type="submit" disabled={confirming}>Accept what is left out</button>
            </form>
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => (planOpen = true)}>Plan again with more screens</button>
          </div>
        {/if}
        {#if form?.message}<p class="flex items-center gap-2 text-danger" role="alert"><CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />{form.message}</p>{/if}
        {#each failed as [key, message] (key)}<p class="flex items-center gap-2 text-danger" role="alert"><CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />{screens.find((s) => s.key === key)?.name ?? key}: {message}</p>{/each}
        {#if notice ?? form?.notice}
          <p class="flex items-center gap-2 text-base-content/80">{notice ?? form?.notice}<button type="button" class="btn btn-ghost btn-xs" aria-label="Dismiss" onclick={() => (notice = null)}><X class="size-3" /></button></p>
        {/if}
      </div>
    {/if}
    <!-- Phones: the screens as a list; the canvas needs a wider screen. Below sm the list follows the
         phone layout (badge by the title, a Play button, a status per row, the approval at the end). -->
    <section class="px-4 pt-6 pb-24 max-sm:flex max-sm:flex-col max-sm:gap-5 max-sm:pt-5 md:hidden" aria-labelledby="ux-phone-title">
      <div class="max-sm:flex max-sm:flex-col max-sm:gap-1.5">
        <div class="max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2.5 max-sm:gap-y-1">
          <h1 id="ux-phone-title" class="text-[28px] font-extrabold tracking-tight">UI reference</h1>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-base-content/80 max-sm:mt-0">
            {#if editing}
              <span class="badge badge-sm gap-1 border-line bg-base-200 text-base-content/80"><PencilLine class="size-3" aria-hidden="true" />Draft v{view.version}</span>
            {:else}
              <span class="badge badge-sm gap-1 border-mint/40 bg-mint-soft text-mint"><Lock class="size-3" aria-hidden="true" />Approved v{view.version}</span>
            {/if}
            <span class="text-base-content/75">{platformLabel(drawnAs)}{#if shellLabel}{" "}· {shellLabel}{/if}</span>
            <span class="max-sm:sr-only">{ready} of {plural(screens.length)} drawn</span>
          </div>
        </div>
        <p class="mt-2 text-[13px] text-base-content/80 max-sm:mt-0 max-sm:text-[14px]">Tap a screen to play it. Edit on a wider screen.</p>
      </div>
      {#if screens.length}
        <div class="max-sm:flex max-sm:flex-col max-sm:gap-2.5">
          <div class="flex items-center justify-between gap-2 sm:hidden">
            <h2 class="text-[15px] font-semibold">Screens <span class="font-normal text-base-content/75">· {ready} of {screens.length} drawn</span></h2>
            <button type="button" class="btn btn-outline h-11" onclick={() => playFrom(null)} disabled={ready === 0}><Play class="size-4" aria-hidden="true" />Play</button>
          </div>
          <ol class="list mt-4 rounded-box border border-line bg-base-100 max-sm:mt-0 max-sm:overflow-hidden">
            {#each screens as screen, i (screen.key)}
              <li class="list-row p-0">
                <button
                  type="button"
                  class="list-col-grow flex min-h-14 w-full items-start gap-3 rounded-box px-4 py-3 text-left hover:bg-base-content/6 disabled:opacity-60 disabled:hover:bg-transparent max-sm:items-center max-sm:rounded-none max-sm:px-3.5 max-sm:py-2"
                  disabled={!screen.html}
                  onclick={() => playFrom(screen.key)}
                >
                  <span class="mt-0.5 w-4 shrink-0 text-[13px] tabular-nums text-base-content/75 max-sm:mt-0" aria-hidden="true">{i + 1}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[14px] font-semibold text-base-content">{screen.name}</span>
                    <span class="mt-0.5 line-clamp-2 block text-[13px] text-base-content/80 max-sm:line-clamp-1">{screen.purpose}</span>
                    {#if screen.html}
                      <span class="mt-0.5 flex items-center gap-1 text-xs font-semibold text-mint sm:hidden"><CircleCheck class="size-3" aria-hidden="true" />Drawn</span>
                    {:else}
                      <span class="mt-1 block text-xs text-base-content/75">Not drawn yet</span>
                    {/if}
                  </span>
                  {#if screen.html}<Play class="mt-1 size-4 shrink-0 text-base-content/80 max-sm:mt-0" aria-hidden="true" />{/if}
                </button>
              </li>
            {/each}
          </ol>
        </div>
        {#if editing && complete}
          <!-- The decision, in thumb reach. The canvas toolbar's copy is hidden on phones, so only one can be used. -->
          <div class="sm:hidden [&>.btn]:h-12 [&>.btn]:w-full">
            <DecisionReceipt
              kind="ux"
              version={view.version}
              replaces={data.ux.approved?.version ?? null}
              summary={`${screens.length} screens`}
              action="?/approve"
              fields={{ revisionId: view.revision_id }}
              label={`Approve v${view.version}`}
              disabled={generating !== null || screenBlockers > 0 || confirmScope}
              title={screenBlockers > 0
                ? `${screenBlockers} finding${screenBlockers === 1 ? "" : "s"} on the screens block approval — open it on a wider screen to fix them`
                : confirmScope
                  ? "Confirm the scope the plan leaves out first"
                  : undefined}
            />
          </div>
        {/if}
      {:else}
        <p class="mt-4 text-[13px] text-base-content/80 max-sm:mt-0">No screens planned yet. Plan them on a wider screen.</p>
      {/if}
    </section>
    <div class="min-h-0 flex-1 max-md:hidden">
      <!-- The canvas has no visible title; the page still has one, and says how to move with the keyboard. -->
      <h1 class="sr-only">UI reference</h1>
      <p class="sr-only">On the canvas, ] and [ move between screens, the arrow keys pan and + and - zoom; the Layers panel lists every screen and its parts, and Play opens the clickable prototype.</p>
      <UxCanvas
        projectId={p}
        {screens}
        {editing}
        {styled}
        libraryName={data.library?.name ?? null}
        components={data.library?.components ?? {}}
        {generating}
        {live}
        drawErrors={errors}
        onDraw={(key) => void generate(key)}
        onRedraw={(key, instruction) => generate(key, instruction)}
        onRemove={(key) => void removeScreen(key)}
        projectLayout={ref?.layout_reference ?? null}
        platform={drawnAs}
        generator={ref?.generator ?? "kit"}
        onScreenLayout={(key) => openLayout({ kind: "screen", key, name: screens.find((s) => s.key === key)?.name ?? key })}
        onSaved={refresh}
        onBusyChange={(b) => (canvasBusy = b)}
        onThemeChange={(t) => (canvasTheme = t)}
        {actions}
      />
    </div>
  </main>

  <PrototypePlayer bind:open={playOpen} {screens} startKey={playStart ?? screens[0]?.key ?? null} theme={styled || od ? canvasTheme : null} platform={drawnAs} />

  <!-- Add a screen -->
  <Modal bind:open={addOpen} labelledby="add-screen-title" describedby="add-screen-desc" boxClass="max-w-[34rem] p-5">
    <h2 id="add-screen-title" class="text-[16px] font-bold text-base-content">Add a screen</h2>
    <p id="add-screen-desc" class="mt-0.5 text-xs text-base-content/80">It is added to the draft and drawn like the others.</p>
    <form
      method="post"
      action="?/addScreen"
      class="mt-4 grid gap-3 sm:grid-cols-2"
      use:enhance={() => {
        addBusy = true;
        return async ({ result, update }) => {
          addBusy = false;
          await update();
          if (result.type === "success") addOpen = false;
        };
      }}
    >
      <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content">Name<input class="input w-full" name="name" required maxlength="80" placeholder="e.g. Results" /></label>
      <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content"><span>Requirements <span class="font-normal text-base-content/80">Optional</span></span><input class="input w-full font-mono" name="requirementKeys" maxlength="200" placeholder="FR-003, FR-007" /></label>
      <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content sm:col-span-2">Purpose<input class="input w-full" name="purpose" maxlength="400" placeholder="Who uses it to do what" /></label>
      <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content sm:col-span-2">
        <span>What it must show <span class="font-normal text-base-content/80">One per line</span></span>
        <textarea class="textarea min-h-[84px] w-full resize-y text-[13px]" name="keyElements" placeholder={"Vote count per option\nClose poll button\nLink back to the poll"}></textarea>
      </label>
      {#if form?.addError}<Notice tone="error" class="sm:col-span-2">{form.addError}</Notice>{/if}
      <div class="flex justify-end gap-2 sm:col-span-2">
        <button class="btn btn-ghost" type="button" onclick={() => (addOpen = false)}>Cancel</button>
        <button class="btn btn-primary" type="submit" disabled={addBusy} aria-busy={addBusy}>{addBusy ? "Adding…" : "Add screen"}</button>
      </div>
    </form>
  </Modal>

  <!-- Change look: the plan stays, the drawings are made again -->
  <Modal bind:open={lookOpen} labelledby="look-title" describedby="look-desc" boxClass="max-w-[34rem] p-5">
    <h2 id="look-title" class="text-[16px] font-bold text-base-content">Change the look</h2>
    <p id="look-desc" class="mt-0.5 text-[13px] text-base-content/80">
      The {plural(screens.length)}, what each must show, the example data and comments stay. Every drawing is cleared and drawn again; the old one stays in each screen's history.{#if data.ux.approved}{" "}Version {data.ux.approved.version} stays in use until you approve the new one.{/if}
    </p>
    <fieldset class="mt-4 flex flex-col gap-1.5">
      <legend class="mb-1.5 text-xs font-semibold text-base-content/80">Platform</legend>
      <div class="join w-full" role="group" aria-label="Platform">
        <button type="button" class="btn btn-sm join-item flex-1 {lookKind === 'web' ? 'btn-active' : ''}" aria-pressed={lookKind === "web"} onclick={() => (lookKind = "web")}><Monitor class="size-3.5" aria-hidden="true" />Web app</button>
        <button type="button" class="btn btn-sm join-item flex-1 {lookKind === 'native-mobile' ? 'btn-active' : ''}" aria-pressed={lookKind === "native-mobile"} onclick={() => (lookKind = "native-mobile")}><Smartphone class="size-3.5" aria-hidden="true" />Android app</button>
      </div>
      {#if lookPlatform}<p class="text-xs text-base-content/80">Redrawn as {platformLabel(lookPlatform)}.</p>{/if}
    </fieldset>
    <fieldset class="mt-4 flex flex-col gap-2">
      <legend class="mb-1.5 text-xs font-semibold text-base-content/80">Look</legend>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:enabled]:hover:bg-base-200">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" value="neutral" bind:group={lookFidelity} />
        <span>
          <span class="font-medium text-base-content">Neutral greys</span>
          <span class="block text-base-content/80">Layout, content and flow only.</span>
        </span>
      </label>
      <label class="flex cursor-pointer items-start gap-2.5 rounded-box border border-line bg-base-100 p-3 text-[13px] transition-colors has-[:checked]:border-primary-ink has-[:checked]:bg-primary-soft has-[:disabled]:cursor-default has-[:enabled]:hover:bg-base-200 {data.designSystem || templateLook ? '' : 'opacity-70'}">
        <input class="radio radio-sm radio-primary mt-0.5" type="radio" value="styled" bind:group={lookFidelity} disabled={!data.designSystem && !templateLook} />
        <span>
          <span class="font-medium text-base-content">{templateLook ? `Template appearance — ${ref?.layout_reference?.name}` : `Design system${data.designSystem ? ` — ${data.designSystem.name} v${data.designSystem.version}` : ""}`}</span>
          <span class="block text-base-content/80">
            {#if templateLook}
              Use the selected template's visual system, including screen-specific overrides.
            {:else if data.designSystem}
              Real colours and type, light and dark.
            {:else}
              Approve a <a class="font-medium text-base-content underline underline-offset-2" href={`/projects/${data.project.id}/design-system`}>design system</a> first.
            {/if}
          </span>
        </span>
      </label>
    </fieldset>
    {#if form?.message}<Notice tone="error" class="mt-3">{form.message}</Notice>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <button class="btn btn-ghost" type="button" onclick={() => (lookOpen = false)}>Cancel</button>
      {@render restyleForm(lookFidelity, `Redraw ${plural(screens.length)}`, "btn btn-primary", lookPlatform)}
    </div>
  </Modal>

  <!-- Plan again -->
  <Modal bind:open={planOpen} labelledby="plan-again-title" describedby="plan-again-desc" boxClass="max-w-[36rem] max-h-[90dvh] overflow-y-auto p-5">
    <h2 id="plan-again-title" class="text-[16px] font-bold text-base-content">Plan the screens again</h2>
    <p id="plan-again-desc" class="mt-0.5 text-[13px] text-base-content/80">
      This replaces the draft, including screens already drawn and their comments.{#if data.ux.approved}{" "}Version {data.ux.approved.version} stays in use until you approve a new one.{/if}
      {#if ref?.count_rationale}<span class="mt-2 block">Current plan: {ref.count_rationale}</span>{/if}
    </p>
    <div class="mt-4">{@render planForm("Plan again")}</div>
  </Modal>
{/if}

<BriefDialog bind:open={briefOpen} {brief} editable={editing} projectId={p} onSaved={refresh} />

<LayoutReferenceDialog
  bind:open={layoutOpen}
  projectId={p}
  initialMode={layoutSource}
  title={layoutScope.kind === "screen" ? `Layout for ${layoutScope.name}` : "Layout reference"}
  useLabel={layoutScope.kind === "plan" ? "Use for the plan" : layoutScope.kind === "draft" ? "Use for all screens" : "Use for this screen"}
  current={layoutCurrent}
  onUse={useLayout}
  onRemove={layoutCurrent ? removeLayout : undefined}
/>
