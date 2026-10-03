<script lang="ts">
  import { enhance } from "$app/forms";
  import { untrack } from "svelte";
  import { Check, ChevronDown, Lock, Monitor, Moon, Play, RotateCcw, Smartphone, Sun } from "lucide-svelte";
  import DecisionReceipt from "$lib/components/DecisionReceipt.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import ChapterNextStep from "$lib/components/ChapterNextStep.svelte";
  import type { Journey } from "$lib/journey.js";
  import DirectionPicker from "$lib/components/design-system/DirectionPicker.svelte";
  import ImportPanel from "$lib/components/design-system/ImportPanel.svelte";
  import PackageViewer from "$lib/components/design-system/PackageViewer.svelte";
  import PaletteEditor from "$lib/components/design-system/PaletteEditor.svelte";
  import ScaleEditor from "$lib/components/design-system/ScaleEditor.svelte";
  import { applyAccent, isHex } from "$lib/ds-color.js";
  import { framedMockup } from "$lib/ux.js";
  import type {
    ComponentLibraryInfo,
    DesignSystemPreset,
    DesignSystemSpec,
    DesignSystemState,
    DsContrastCheck,
    DsDensity,
    DsDepth,
    DsDirection,
    DsPackage,
  } from "$lib/types.js";

  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; name: string };
      /** From the project layout: the one next step. */
      journey?: Journey;
      catalog: { presets: DesignSystemPreset[]; libraries: ComponentLibraryInfo[]; directions: DsDirection[] };
      state: DesignSystemState;
    };
    form: { ok?: boolean; notice?: string; message?: string; approved?: boolean } | null;
  } = $props();

  const pid = $derived(data.project.id);
  const approved = $derived(data.state.approved);
  const draft = $derived(data.state.draft);

  /* ── Fonts: every stack ends in a system fallback, so mockups never load fonts. ── */
  const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const FONT_PAIRS = [
    { id: "inter", label: "Inter — clean sans", display: `"Inter", ${SYSTEM}`, body: `"Inter", ${SYSTEM}` },
    { id: "system", label: "System UI — the device's own font", display: SYSTEM, body: SYSTEM },
    { id: "serif-head", label: "Fraunces headlines + Inter text", display: '"Fraunces", "Iowan Old Style", Georgia, "Times New Roman", serif', body: `"Inter", ${SYSTEM}` },
    { id: "serif", label: "Fraunces + Newsreader — all serif", display: '"Fraunces", "Iowan Old Style", Georgia, "Times New Roman", serif', body: '"Newsreader", "Iowan Old Style", Georgia, "Times New Roman", serif' },
    { id: "geometric", label: "Manrope — geometric", display: `"Manrope", "Avenir Next", ${SYSTEM}`, body: `"Manrope", "Avenir Next", ${SYSTEM}` },
    { id: "humanist", label: "Source Sans 3 — humanist", display: `"Source Sans 3", "Segoe UI", "Helvetica Neue", ${SYSTEM}`, body: `"Source Sans 3", "Segoe UI", "Helvetica Neue", ${SYSTEM}` },
    { id: "rounded", label: "Nunito — rounded", display: `"Nunito", "Segoe UI", ${SYSTEM}`, body: `"Nunito", "Segoe UI", ${SYSTEM}` },
    { id: "grotesk", label: "Space Grotesk — raw grotesque", display: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif', body: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif' },
    { id: "mono", label: "JetBrains Mono — monospace everywhere", display: MONO, body: MONO },
  ];
  const DENSITIES: Array<{ id: DsDensity; label: string }> = [
    { id: "compact", label: "Compact" },
    { id: "comfortable", label: "Comfortable" },
    { id: "spacious", label: "Spacious" },
  ];
  const DEPTHS: Array<{ id: DsDepth; label: string }> = [
    { id: "flat", label: "Flat — no borders or shadows" },
    { id: "hairline", label: "Hairline borders" },
    { id: "soft", label: "Soft shadows" },
    { id: "hard", label: "Hard offset shadows" },
  ];

  function fromPreset(p: DesignSystemPreset, library: string): DesignSystemSpec {
    const { id, tags: _tags, ...rest } = structuredClone($state.snapshot(p)) as DesignSystemPreset;
    return { ...rest, preset_id: id, component_library: library };
  }

  // Suggestions follow the locked stack; the first is the recommendation.
  const suggestionFor = (id: string) => data.state.suggestions.find((s) => s.library_id === id);
  const recommended = $derived(data.state.suggestions[0]?.library_id ?? "none");
  const orderedLibraries = $derived([
    ...data.state.suggestions.map((s) => data.catalog.libraries.find((l) => l.id === s.library_id)).filter((l): l is ComponentLibraryInfo => Boolean(l)),
    ...data.catalog.libraries.filter((l) => !suggestionFor(l.id)),
  ]);

  // What is being edited: the draft, else a copy of the approved one, else the first preset.
  let spec = $state<DesignSystemSpec>(
    untrack(() =>
      structuredClone(
        data.state.draft?.spec ??
          data.state.approved?.spec ??
          fromPreset(data.catalog.presets[0]!, data.state.suggestions[0]?.library_id ?? "none"),
      ),
    ),
  );
  let editing = $state(untrack(() => !data.state.approved || Boolean(data.state.draft)));
  let savedJson = $state(untrack(() => (data.state.draft?.spec ? JSON.stringify(data.state.draft.spec) : "")));
  const dirty = $derived(JSON.stringify(spec) !== savedJson);
  const canApprove = $derived(Boolean(draft) && !dirty);

  // Steps 1 and 2 show a few choices first ("+N more" shows the rest); the chosen one always shows.
  let showAllPresets = $state(false);
  let showAllLibraries = $state(false);
  const visiblePresets = $derived(
    showAllPresets ? data.catalog.presets : data.catalog.presets.filter((p, i) => i < 6 || p.id === spec.preset_id),
  );
  const visibleLibraries = $derived(
    showAllLibraries ? orderedLibraries : orderedLibraries.filter((l, i) => i < 3 || l.id === spec.component_library),
  );

  const preset = $derived(data.catalog.presets.find((p) => p.id === spec.preset_id));
  const fontPair = $derived(FONT_PAIRS.find((f) => f.display === spec.fonts.display && f.body === spec.fonts.body)?.id ?? "custom");
  let accentInput = $state(untrack(() => spec.light.accent));

  function choosePreset(p: DesignSystemPreset) {
    // A preset replaces the look; scale overrides are structure and stay.
    const scale = spec.scale ? structuredClone($state.snapshot(spec.scale)) : undefined;
    spec = { ...fromPreset(p, spec.component_library), ...(scale ? { scale } : {}) };
    accentInput = spec.light.accent;
  }

  /* ── Visual direction (open-design): palettes and fonts come from it, posture rules travel with it. ── */
  const activeDirection = $derived(data.catalog.directions.find((d) => d.id === spec.direction) ?? null);
  const directionOf = (s: DesignSystemSpec) => data.catalog.directions.find((d) => d.id === s.direction) ?? null;
  function chooseDirection(d: DsDirection) {
    const next = structuredClone($state.snapshot(d)) as DsDirection;
    spec.light = next.light;
    spec.dark = next.dark;
    spec.fonts = next.fonts;
    spec.direction = next.id;
    // No longer a preset's palette: "Reset to preset" would undo the direction.
    spec.preset_id = "custom";
    accentInput = spec.light.accent;
  }
  function resetToPreset() {
    if (preset) choosePreset(preset);
  }
  function setAccent(value: string) {
    accentInput = value;
    if (!isHex(value)) return;
    const next = applyAccent(spec.light, spec.dark, value.toLowerCase());
    spec.light = next.light;
    spec.dark = next.dark;
  }
  /** A pasted design system replaces every value; the preview follows. */
  function applyImported(next: DesignSystemSpec) {
    spec = next;
    accentInput = next.light.accent;
  }
  function setFontPair(id: string) {
    const pair = FONT_PAIRS.find((f) => f.id === id);
    if (pair) spec.fonts = { display: pair.display, body: pair.body, mono: spec.fonts.mono };
  }

  /* ── Live preview: rendered by the API from the current, unsaved values. ── */
  let mode = $state<"light" | "dark">("light");
  let viewport = $state<"desktop" | "mobile">("desktop");
  let previewHtml = $state("");
  let contrast = $state<DsContrastCheck[]>([]);
  let previewError = $state<string | null>(null);
  let updating = $state(false);
  // Phones: the preview folds into a small card; "Preview" opens the full one.
  let previewOpen = $state(false);

  $effect(() => {
    const body = JSON.stringify({ spec: $state.snapshot(spec), mode });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      updating = true;
      try {
        const res = await fetch(`/projects/${pid}/design-system/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
        });
        const payload = (await res.json()) as { html?: string; contrast?: DsContrastCheck[]; message?: string };
        if (!res.ok) {
          previewError = payload.message ?? "The preview could not be drawn.";
          return;
        }
        previewError = null;
        previewHtml = payload.html ?? "";
        contrast = payload.contrast ?? [];
      } catch (e) {
        if ((e as Error).name !== "AbortError") previewError = "The preview could not be drawn. Check your connection.";
      } finally {
        if (!controller.signal.aborted) updating = false;
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const failing = $derived(contrast.filter((c) => !c.ok));

  /* ── What the agent gets: the live package for the values shown (the editor's, else the approved one). ── */
  let pkg = $state<DsPackage | null>(null);
  let pkgLoading = $state(false);
  let pkgError = $state<string | null>(null);
  const packageSpec = $derived(!editing && approved?.spec ? approved.spec : spec);

  $effect(() => {
    const body = JSON.stringify({ spec: $state.snapshot(packageSpec) });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      pkgLoading = true;
      try {
        const res = await fetch(`/projects/${pid}/design-system/package`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
        });
        const payload = (await res.json().catch(() => ({}))) as Partial<DsPackage> & { message?: string };
        if (!res.ok || !Array.isArray(payload.files)) {
          pkgError = payload.message ?? "The package could not be built.";
          return;
        }
        pkgError = null;
        pkg = { files: payload.files };
      } catch (e) {
        if ((e as Error).name !== "AbortError") pkgError = "The package could not be built. Check your connection.";
      } finally {
        if (!controller.signal.aborted) pkgLoading = false;
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  // The values tokens.css declares in its unscoped :root, for the scale editor's derived placeholders.
  const effectiveTokens = $derived.by(() => {
    const css = pkg?.files.find((f) => f.role === "tokens")?.content ?? "";
    const root = /:root(?!\[)\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const out: Record<string, string> = {};
    for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]!] = m[2]!.trim();
    return out;
  });

  let saving = $state(false);

  const swatchKeys = ["bg", "surface2", "fgMuted", "accent", "fg"] as const;
  const approvedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const libraryName = (id: string) => data.catalog.libraries.find((l) => l.id === id)?.name ?? id;
</script>

<svelte:head>
  <title>Design system — {data.project.name}</title>
</svelte:head>

{#snippet swatches(s: DesignSystemSpec | DesignSystemPreset, which: "light" | "dark", size = "h-6")}
  <span class="flex overflow-hidden rounded-field border border-line" aria-hidden="true">
    {#each swatchKeys as k (k)}
      <span class="{size} flex-1" style="background: {s[which][k]}"></span>
    {/each}
  </span>
{/snippet}

{#snippet step(n: number)}
  <span class="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-control font-mono text-xs font-medium" aria-hidden="true">{n}</span>
{/snippet}

{#snippet previewCard(s: DesignSystemSpec)}
  {@const k = s[mode]}
  <!-- Phones only: a small picture of the kit and the button that opens the full preview. -->
  <section class="card flex flex-row items-center gap-3.5 border border-line bg-base-100 p-3 sm:hidden" aria-labelledby="preview-card-title">
    <div
      class="grid h-[88px] w-[132px] shrink-0 grid-cols-[34px_minmax(0,1fr)] overflow-hidden rounded-lg"
      style="background: {k.bg}; box-shadow: 0 0 0 1px {k.border}"
      aria-hidden="true"
    >
      <div class="flex flex-col gap-1 px-[5px] py-2" style="background: {k.surface}; border-right: 1px solid {k.border}">
        <span class="size-2.5 rounded-[3px]" style="background: {k.accent}"></span>
        <span class="h-[5px] rounded-sm" style="background: {k.fgMuted}"></span>
        <span class="h-[5px] rounded-sm" style="background: {k.fgMuted}"></span>
      </div>
      <div class="flex flex-col gap-1.5 p-2">
        <span class="flex items-center justify-between"><span class="h-1.5 w-9 rounded-sm" style="background: {k.fg}"></span><span class="h-2.5 w-[22px] rounded-[3px]" style="background: {k.accent}"></span></span>
        <span class="grid grid-cols-3 gap-1">
          {#each [0, 1, 2] as i (i)}<span class="h-4 rounded-[3px]" style="background: {k.surface}; border: 1px solid {k.border}"></span>{/each}
        </span>
        <span class="flex-1 rounded-[3px]" style="background: {k.surface}; border: 1px solid {k.border}"></span>
      </div>
    </div>
    <div class="flex min-w-0 flex-1 flex-col items-start gap-2">
      <h2 id="preview-card-title" class="text-[14px] font-semibold">Live preview</h2>
      <button type="button" class="btn btn-outline h-11" aria-expanded={previewOpen} aria-controls="ds-preview" onclick={() => (previewOpen = !previewOpen)}>
        {#if previewOpen}<ChevronDown class="size-4 rotate-180" aria-hidden="true" />Hide preview{:else}<Play class="size-4" aria-hidden="true" />Preview{/if}
      </button>
    </div>
  </section>
{/snippet}

{#snippet preview()}
  <section id="ds-preview" class="flex min-w-0 flex-col gap-3 {previewOpen ? '' : 'max-sm:hidden'}" aria-labelledby="preview-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="preview-title" class="text-[14px] font-semibold">
        Live preview <span class="font-normal text-base-content/80" aria-live="polite">{updating ? "· updating…" : ""}</span>
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <div class="join" role="group" aria-label="Colour mode">
          <button type="button" class="btn btn-sm join-item {mode === 'light' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={mode === "light"} onclick={() => (mode = "light")}>
            <Sun class="size-3.5" aria-hidden="true" />Light
          </button>
          <button type="button" class="btn btn-sm join-item {mode === 'dark' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={mode === "dark"} onclick={() => (mode = "dark")}>
            <Moon class="size-3.5" aria-hidden="true" />Dark
          </button>
        </div>
        <div class="join" role="group" aria-label="Preview width">
          <button type="button" class="btn btn-sm join-item {viewport === 'desktop' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={viewport === "desktop"} onclick={() => (viewport = "desktop")}>
            <Monitor class="size-3.5" aria-hidden="true" />Desktop
          </button>
          <button type="button" class="btn btn-sm join-item {viewport === 'mobile' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={viewport === "mobile"} onclick={() => (viewport = "mobile")}>
            <Smartphone class="size-3.5" aria-hidden="true" />Mobile
          </button>
        </div>
      </div>
    </div>
    {#if previewError}
      <Notice tone="error">{previewError}</Notice>
    {/if}
    <div class="overflow-hidden rounded-box bg-base-300 p-3">
      {#if previewHtml}
        <iframe
          title="Preview of {spec.name} in {mode} mode"
          sandbox=""
          srcdoc={framedMockup(previewHtml)}
          class="mx-auto block h-[640px] rounded-field border border-line bg-white lg:h-[calc(100vh-280px)] lg:min-h-[520px]"
          style="width: {viewport === 'mobile' ? '390px' : '100%'}; max-width: 100%"
        ></iframe>
      {:else}
        <div class="flex h-[320px] items-center justify-center text-[13px] text-base-content/80">Drawing the preview…</div>
      {/if}
    </div>
    <p class="text-xs text-base-content/80">Fonts show as system fallbacks here.</p>
  </section>
{/snippet}

{#snippet posture(d: DsDirection)}
  <!-- The direction's posture rules: the agent gets them with the design system. -->
  <div class="flex flex-col gap-1">
    <h3 class="text-xs font-semibold text-base-content/80">{d.label} posture</h3>
    <ul class="flex list-disc flex-col gap-0.5 ps-4 text-xs leading-relaxed text-base-content/80">
      {#each d.posture as rule, i (i)}<li>{rule}</li>{/each}
    </ul>
  </div>
{/snippet}

{#snippet agentGets()}
  <details class="collapse collapse-arrow rounded-box border border-line bg-base-100">
    <summary class="collapse-title min-h-12 text-[13px] font-semibold">What the agent gets</summary>
    <div class="collapse-content">
      <PackageViewer {pkg} loading={pkgLoading} error={pkgError} />
    </div>
  </details>
{/snippet}

<main class="flex flex-col gap-6 pb-10">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex min-w-0 flex-col gap-1.5">
      {#if !editing && approved?.spec}
        <h1 class="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
          Design system <span class="font-mono font-medium tracking-tighter">v{approved.version}</span> — <span class="text-primary-ink">in use</span>
        </h1>
        {#if approved.approved_at}
          <p class="text-[14px] text-base-content/80">Approved <time datetime={approved.approved_at}>{approvedFormat.format(new Date(approved.approved_at))}</time>.</p>
        {/if}
      {:else}
        <h1 class="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">Give the app one look.</h1>
        <p class="text-[14px] text-base-content/80">Optional. The agent follows it on every screen.</p>
      {/if}
    </div>
    {#if editing && (draft || approved)}
      <!-- One status: the draft being edited, else the version in use. -->
      {#if draft}
        <span class="badge badge-sm border-line bg-base-100 text-base-content/80">Draft · v{draft.version}</span>
      {:else if approved}
        <span class="badge badge-sm border-mint/40 bg-mint-soft text-mint"><Lock class="size-3" aria-hidden="true" />In use · v{approved.version}</span>
      {/if}
    {/if}
  </header>

  {#if form?.message}
    <Notice tone="error">{form.message}</Notice>
  {:else if form?.notice}
    <Notice tone="success">{form.notice}</Notice>
  {/if}
  {#if data.state.stale}
    <Notice tone="warn">The stack changed after this was approved. Check the component library and approve it again.</Notice>
  {/if}

  {#if !data.state.stack_approved}
    <Notice tone="warn">
      Lock the stack first — the component library depends on it.
      <a class="font-medium underline underline-offset-2" href={`/projects/${pid}/stack`}>Choose the stack</a>.
    </Notice>
  {:else if !editing && approved?.spec}
    {@const s = approved.spec}
    <ChapterNextStep journey={data.journey} projectId={pid} chapter="system" />
    <div class="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-8">
      <div class="flex flex-col gap-4">
        <section class="card flex flex-col gap-4 border border-line bg-base-100 p-5" aria-labelledby="in-use-title">
          <div class="flex flex-col gap-1">
            <h2 id="in-use-title" class="text-[16px] font-bold">{s.name}</h2>
            <p class="text-[13px] leading-relaxed text-base-content/80">{s.summary}</p>
          </div>
          <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-base-content/80">
            <span>Light</span>{@render swatches(s, "light")}
            <span>Dark</span>{@render swatches(s, "dark")}
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt class="text-base-content/80">Library</dt><dd class="font-medium">{libraryName(s.component_library)}</dd>
            <dt class="text-base-content/80">Fonts</dt><dd>{s.fonts.display.split(",")[0]?.replace(/"/g, "")} / {s.fonts.body.split(",")[0]?.replace(/"/g, "")}</dd>
            <dt class="text-base-content/80">Shape</dt><dd>{s.radius}px radius · {s.border_width}px borders · {s.depth}</dd>
            <dt class="text-base-content/80">Density</dt><dd class="capitalize">{s.density}</dd>
            {#if directionOf(s)}
              <dt class="text-base-content/80">Direction</dt><dd>{directionOf(s)?.label}</dd>
            {/if}
          </dl>
          {#if directionOf(s)}
            {@render posture(directionOf(s)!)}
          {/if}
          <button class="btn btn-outline self-start" type="button" onclick={() => (editing = true)}>Change design system</button>
        </section>
        {@render agentGets()}
      </div>
      <div class="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">{@render previewCard(s)}{@render preview()}</div>
    </div>
  {:else}
    <div class="grid gap-8 lg:grid-cols-[minmax(0,452px)_minmax(0,1fr)]">
      <!-- The three steps, quiet, one after another -->
      <div class="flex min-w-0 flex-col gap-6">
        <!-- 1. Starting style -->
        <fieldset class="flex min-w-0 flex-col gap-2.5">
          <legend class="mb-2.5 flex items-center gap-2.5 text-[14px] font-semibold">{@render step(1)}Starting style</legend>
          {#if data.catalog.directions.length}
            <!-- A visual direction first: a palette, fonts and posture rules to start from. -->
            <div class="flex flex-col gap-2 pl-8 max-sm:pl-0">
              <h3 class="text-[13px] font-medium text-base-content/80">Visual direction</h3>
              <DirectionPicker directions={data.catalog.directions} active={spec.direction} onChoose={chooseDirection} />
              {#if activeDirection}
                {@render posture(activeDirection)}
              {/if}
            </div>
            <h3 class="mt-2 pl-8 text-[13px] font-medium text-base-content/80 max-sm:pl-0">Or start from a preset</h3>
          {/if}
          <div class="grid grid-cols-2 gap-1.5 pl-8 max-sm:pl-0">
            {#each visiblePresets as p (p.id)}
              {@const on = spec.preset_id === p.id}
              <label
                class="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-field border px-3 py-1.5 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-ink {on
                  ? 'border-primary-ink bg-primary-soft font-semibold'
                  : 'border-line bg-base-200 hover:bg-base-100'}"
                title={p.summary}
              >
                <input class="sr-only" type="radio" name="preset" value={p.id} checked={on} onchange={() => choosePreset(p)} />
                <span class="w-10 shrink-0">{@render swatches(p, "light", "h-3.5")}</span>
                <span class="min-w-0 flex-1 truncate">{p.name}</span>
                {#if on}<Check class="size-3.5 shrink-0 text-primary-ink" aria-hidden="true" />{/if}
              </label>
            {/each}
          </div>
          {#if preset}
            <p class="pl-8 text-xs leading-relaxed text-base-content/80 max-sm:pl-0">{preset.summary}</p>
          {/if}
          {#if data.catalog.presets.length > 6}
            <button type="button" class="btn btn-ghost btn-sm ml-6 self-start max-sm:-ml-2 max-sm:h-11" aria-expanded={showAllPresets} onclick={() => (showAllPresets = !showAllPresets)}>
              {showAllPresets ? "Show fewer" : `+${data.catalog.presets.length - visiblePresets.length} more`}
            </button>
          {/if}
        </fieldset>
        <!-- Or start from the person's own system: pasted tokens, a theme or a DESIGN.md. -->
        <div class="-mt-3 pl-8 max-sm:pl-0">
          <ImportPanel projectId={pid} current={spec} onApply={applyImported} />
        </div>

        <div class="ml-8 h-px bg-line max-sm:ml-0"></div>

        <!-- 2. Component library -->
        <fieldset class="flex min-w-0 flex-col gap-2.5">
          <legend class="mb-2.5 flex items-center gap-2.5 text-[14px] font-semibold">{@render step(2)}Component library</legend>
          <div class="flex flex-col gap-1.5 pl-8 max-sm:pl-0">
            {#each visibleLibraries as lib (lib.id)}
              {@const on = spec.component_library === lib.id}
              {@const why = suggestionFor(lib.id)}
              <label
                class="flex cursor-pointer items-start gap-3 rounded-box border px-3.5 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-ink {on
                  ? 'border-primary-ink bg-primary-soft'
                  : 'border-line bg-base-200 hover:bg-base-100'}"
              >
                <input class="radio radio-sm radio-primary mt-0.5 shrink-0" type="radio" name="library" value={lib.id} bind:group={spec.component_library} />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="text-[13px] font-semibold">{lib.name}</span>
                    {#if lib.id === recommended}<span class="badge badge-sm border-mint/40 bg-mint-soft text-mint">Recommended</span>{/if}
                  </span>
                  <span class="text-xs leading-relaxed text-base-content/80 {on ? '' : 'line-clamp-1'}">{why?.reason ?? lib.summary}</span>
                  {#if on && lib.frameworks.length}
                    <span class="text-xs text-base-content/80">{lib.frameworks.join(" · ")}{lib.license !== "—" ? ` · ${lib.license}` : ""}</span>
                  {/if}
                </span>
              </label>
            {/each}
            {#if orderedLibraries.length > 3}
              <button type="button" class="btn btn-ghost btn-sm -ml-2 self-start max-sm:h-11" aria-expanded={showAllLibraries} onclick={() => (showAllLibraries = !showAllLibraries)}>
                {showAllLibraries ? "Show fewer" : `+${orderedLibraries.length - visibleLibraries.length} more`}
              </button>
            {/if}
          </div>
        </fieldset>

        <div class="ml-8 h-px bg-line max-sm:ml-0"></div>

        <!-- 3. Adjust -->
        <section class="flex min-w-0 flex-col gap-3" aria-labelledby="adjust-title">
          <div class="flex items-center gap-2.5">
            {@render step(3)}
            <h2 id="adjust-title" class="text-[14px] font-semibold">Adjust</h2>
            {#if preset}
              <button class="btn btn-ghost btn-sm ml-auto max-sm:-me-2 max-sm:h-11" type="button" onclick={resetToPreset}>
                <RotateCcw class="size-3.5" aria-hidden="true" />Reset to preset
              </button>
            {/if}
          </div>
          <div class="flex flex-col gap-3.5 pl-8 max-sm:pl-0">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                Name
                <input class="input w-full text-base-content" maxlength="80" bind:value={spec.name} />
              </label>
              <div class="flex flex-col gap-1.5">
                <label for="accent-hex" class="text-[13px] font-medium text-base-content/80">Brand colour</label>
                <div class="flex items-center gap-1.5">
                  <input
                    class="h-10 w-11 shrink-0 cursor-pointer max-sm:h-11 rounded-field border border-line-control bg-base-100 p-1"
                    type="color"
                    aria-label="Pick the brand colour"
                    value={isHex(accentInput) ? accentInput : spec.light.accent}
                    oninput={(e) => setAccent(e.currentTarget.value)}
                  />
                  <input
                    id="accent-hex"
                    class="input w-full font-mono text-[13px]"
                    maxlength="7"
                    value={accentInput}
                    aria-invalid={!isHex(accentInput)}
                    aria-describedby="accent-used"
                    oninput={(e) => setAccent(e.currentTarget.value.trim())}
                  />
                </div>
              </div>
            </div>
            <p id="accent-used" class="text-xs text-base-content/80">
              Kept readable: light <code class="font-mono">{spec.light.accent}</code> · dark <code class="font-mono">{spec.dark.accent}</code>
            </p>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                Fonts
                <select class="select w-full text-base-content" value={fontPair} onchange={(e) => setFontPair(e.currentTarget.value)}>
                  {#if fontPair === "custom"}<option value="custom">Current fonts ({spec.fonts.body.split(",")[0]?.replace(/"/g, "")})</option>{/if}
                  {#each FONT_PAIRS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
                </select>
              </label>
              <div class="flex flex-col gap-1.5">
                <label for="radius" class="flex items-center justify-between text-[13px] font-medium text-base-content/80">
                  Corner radius <output for="radius" class="font-mono text-xs">{spec.radius}px</output>
                </label>
                <input id="radius" type="range" min="0" max="24" step="1" bind:value={spec.radius} class="range range-sm range-primary my-auto w-full" />
              </div>
            </div>

            <details class="group">
              <summary class="btn btn-ghost btn-sm -ml-3 list-none [&::-webkit-details-marker]:hidden">
                <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />Advanced
              </summary>
              <div class="mt-3 flex flex-col gap-3.5">
                <fieldset class="flex flex-col gap-1.5">
                  <legend class="mb-1.5 text-[13px] font-medium text-base-content/80">Density</legend>
                  <div class="join grid grid-cols-3">
                    {#each DENSITIES as d (d.id)}
                      <label class="btn btn-sm join-item has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-ink {spec.density === d.id ? 'btn-active' : 'font-normal text-base-content/80'}">
                        <input class="sr-only" type="radio" name="density" value={d.id} bind:group={spec.density} />{d.label}
                      </label>
                    {/each}
                  </div>
                </fieldset>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="flex flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                    Surfaces
                    <select class="select w-full text-base-content" bind:value={spec.depth}>
                      {#each DEPTHS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
                    </select>
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                    Border width
                    <select class="select w-full text-base-content" bind:value={spec.border_width}>
                      <option value={1}>1px</option>
                      <option value={2}>2px</option>
                      <option value={3}>3px</option>
                    </select>
                  </label>
                </div>
                <!-- The exact font lists: family names in order, a generic family last. -->
                <fieldset class="flex flex-col gap-2">
                  <legend class="mb-1.5 text-[13px] font-medium text-base-content/80">Font stacks</legend>
                  {#each [["display", "Headings"], ["body", "Text"], ["mono", "Code"]] as const as [role, label] (role)}
                    <label class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-xs text-base-content/80">
                      {label}
                      <input class="input input-sm w-full font-mono text-xs text-base-content max-sm:h-11" maxlength="200" spellcheck="false" bind:value={spec.fonts[role]} />
                    </label>
                  {/each}
                </fieldset>
                <ScaleEditor bind:spec effective={effectiveTokens} />
              </div>
            </details>

            <details class="group">
              <summary class="btn btn-ghost btn-sm -ml-3 list-none [&::-webkit-details-marker]:hidden">
                <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />All colours
              </summary>
              <div class="mt-3">
                <PaletteEditor bind:spec checks={contrast} onAccent={(hex) => (accentInput = hex)} />
              </div>
            </details>

            <details class="group">
              <summary class="btn btn-ghost btn-sm -ml-3 list-none [&::-webkit-details-marker]:hidden">
                <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />Summary and guidance
              </summary>
              <div class="mt-3 flex flex-col gap-3">
                <label class="flex flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                  <span class="flex items-center justify-between">Summary <span class="font-mono text-xs font-normal tabular-nums">{spec.summary.length}/300</span></span>
                  <textarea class="textarea h-16 w-full text-[13px] text-base-content" maxlength="300" bind:value={spec.summary}></textarea>
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-medium text-base-content/80">
                  <span class="flex items-center justify-between">Guidance for the agent <span class="font-mono text-xs font-normal tabular-nums">{spec.guidance.length}/6000</span></span>
                  <textarea class="textarea h-56 w-full font-mono text-xs leading-relaxed text-base-content" maxlength="6000" spellcheck="false" bind:value={spec.guidance}></textarea>
                  <span class="text-xs font-normal">Markdown. The agent reads it with every screen and task; it doesn't change the preview.</span>
                </label>
              </div>
            </details>
          </div>
        </section>

        <!-- Contrast -->
        {#if contrast.length}
          {#if failing.length}
            <Notice tone="warn">
              {failing.length} colour {failing.length === 1 ? "pair is" : "pairs are"} too hard to read:
              {failing.map((f) => `${f.pair.toLowerCase()} (${f.mode}, ${f.ratio}:1)`).join("; ")}. Pick a different brand colour or reset.
            </Notice>
          {:else}
            <Notice tone="success">All {contrast.length} pairs meet WCAG AA in light and dark.</Notice>
          {/if}
        {/if}

        {@render agentGets()}
      </div>

      <!-- The live preview is the hero; the decision sits under it. -->
      <div class="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        {@render previewCard(spec)}
        {@render preview()}

        <!-- Phones: the decision card ends the page (the next-step bar owns the bottom edge), primary full width. -->
        <div class="card flex flex-row flex-wrap items-center gap-3 border border-line bg-base-100 px-4 py-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5 max-sm:p-4 sm:sticky sm:bottom-0 sm:z-10 lg:static max-sm:[&>.btn-primary]:h-12">
          <p class="min-w-0 flex-1 text-[13px] text-base-content/80">
            {#if canApprove && draft}
              Draft v{draft.version} saved. No undo — later changes become a new version.
            {:else if dirty && draft}
              Unsaved changes to draft v{draft.version}.
            {:else}
              Saved as a draft first.
            {/if}
          </p>
          {#if approved}
            <button
              class="btn btn-ghost max-sm:order-last"
              type="button"
              onclick={() => {
                editing = false;
                if (approved?.spec) spec = structuredClone($state.snapshot(approved.spec));
                // The brand-colour field has its own text (it may hold a half-typed
                // hex): put it back to the colour now in use.
                accentInput = spec.light.accent;
              }}>Cancel</button
            >
          {/if}
          {#if canApprove && draft}
            <DecisionReceipt
              kind="design_system"
              version={draft.version}
              replaces={data.state.approved?.version ?? null}
              action="?/approve"
              fields={{ revisionId: draft.revision_id }}
              label="Approve design system"
              onDone={(ok) => {
                if (ok) editing = false;
              }}
            />
          {:else}
            <form
              method="post"
              action="?/save"
              class="max-sm:w-full"
              use:enhance={() => {
                saving = true;
                const snapshot = JSON.stringify($state.snapshot(spec));
                return async ({ result, update }) => {
                  saving = false;
                  if (result.type === "success") savedJson = snapshot;
                  await update({ reset: false });
                };
              }}
            >
              <input type="hidden" name="spec" value={JSON.stringify(spec)} />
              <button class="btn btn-primary max-sm:btn-lg max-sm:w-full" type="submit" disabled={saving || failing.length > 0} aria-busy={saving}>
                {saving ? "Saving…" : "Save draft"}
              </button>
            </form>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>
