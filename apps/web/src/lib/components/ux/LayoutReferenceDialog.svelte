<script lang="ts">
  import { FileCode2, ScanSearch, Trash2 } from "lucide-svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import LayoutReferenceSummary from "./LayoutReferenceSummary.svelte";
  import type { LayoutReference } from "$lib/types.js";
  import type { UiTemplate, UiTemplateCategory } from "$lib/ui-templates.js";

  /**
   * Bring your own layout: paste a page's HTML (or pick an .html file), the AI
   * reads its structure and optionally visual tokens, without executing scripts; the person
   * checks the brief before screens follow it. Where it applies (every screen,
   * one screen, the next plan) is the caller's: `onUse` stores it.
   */
  let {
    open = $bindable(false),
    projectId,
    title,
    useLabel,
    current = null,
    onUse,
    onRemove,
    initialMode = "builtin",
  }: {
    open?: boolean;
    projectId: string;
    title: string;
    /** "Use for all screens", "Use for this screen". */
    useLabel: string;
    /** The reference in use now, shown with Remove. */
    current?: LayoutReference | null;
    /** Stores the reference; resolves to an error message, or null when it worked. */
    onUse: (reference: LayoutReference) => Promise<string | null>;
    onRemove?: () => Promise<string | null>;
    initialMode?: "builtin" | "own";
  } = $props();

  /** Read at most this much of a file; the server reads 200k characters of it anyway. */
  const MAX_FILE_BYTES = 2_000_000;

  let html = $state("");
  let name = $state("");
  let analysed = $state<LayoutReference | null>(null);
  let busy = $state<"analyse" | "use" | "remove" | null>(null);
  let error = $state<string | null>(null);
  let mode = $state<"builtin" | "own">("builtin");
  let strategy = $state<"adapt" | "layout">("adapt");
  let category = $state<UiTemplateCategory | "All">("All");
  let search = $state("");
  let catalog = $state<UiTemplate[]>([]);
  let loadingCatalog = $state(false);
  let templateId = $state("");
  const categories = $derived([...new Set(catalog.map((t) => t.category))]);
  const templates = $derived(catalog.filter((t) => (category === "All" || t.category === category) && `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase().trim())));
  const selected = $derived(catalog.find((t) => t.id === templateId));

  async function loadCatalog() {
    loadingCatalog = true;
    error = null;
    analysed = null;
    try {
      const response = await fetch("/ui-templates", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Could not load the template collection.");
      catalog = body.templates;
      if (!catalog.some((t) => t.id === templateId)) {
        templateId = catalog[0]?.id ?? "";
        analysed = null;
      }
      if (category !== "All" && !catalog.some((t) => t.category === category)) category = "All";
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load the template collection.";
    } finally {
      loadingCatalog = false;
    }
  }

  function chooseMode(next: "builtin" | "own") {
    mode = next;
    analysed = null;
    error = null;
  }

  // Every opening starts clean: a brief from last time must not be used by accident.
  $effect(() => {
    if (!open) return;
    html = "";
    name = "";
    analysed = null;
    error = null;
    mode = initialMode;
    strategy = current?.mode ?? "adapt";
    category = "All";
    search = "";
    templateId = "";
    void loadCatalog();
  });

  async function pickFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      html = "";
      analysed = null;
      error = "That file is over 2 MB — paste the part of the page with the layout instead.";
      return;
    }
    html = await file.text();
    if (!name) name = file.name.replace(/\.html?$/i, "").slice(0, 80);
    analysed = null;
    error = null;
  }

  async function analyse() {
    busy = "analyse";
    error = null;
    analysed = null;
    try {
      const res = await fetch(`/projects/${projectId}/ux/layout-reference`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "builtin" ? { op: "analyse-template", templateId, mode: strategy } : { op: "analyse", html, name, mode: strategy }),
      });
      const body = (await res.json().catch(() => ({}))) as { reference?: LayoutReference; message?: string };
      if (!res.ok || !body.reference) error = body.message ?? "The page could not be read. Try again.";
      else analysed = body.reference;
    } catch {
      error = "The connection dropped while reading the page. Try again.";
    } finally {
      busy = null;
    }
  }

  async function use() {
    if (!analysed) return;
    busy = "use";
    error = await onUse(analysed);
    busy = null;
    if (!error) open = false;
  }

  async function remove() {
    if (!onRemove) return;
    busy = "remove";
    error = await onRemove();
    busy = null;
    if (!error) open = false;
  }
</script>

<Modal bind:open dismissible={busy === null} labelledby="layout-ref-title" describedby="layout-ref-desc" boxClass="flex max-h-[90dvh] max-w-[56rem] flex-col gap-4 overflow-y-auto p-5">
  <div>
    <h2 id="layout-ref-title" class="text-[16px] font-bold text-base-content">{title}</h2>
    <p id="layout-ref-desc" class="mt-0.5 text-[13px] text-base-content/80">
      Choose a template or bring your own HTML. Adapt its appearance and structure, or take only its layout. Required screens and permissions come from the product; login stays outside the app sidebar.
    </p>
  </div>

  <div class="flex flex-col gap-2">
    <label for="template-strategy" class="text-[13px] font-semibold text-base-content">How to use the template</label>
    <select id="template-strategy" class="select w-full" bind:value={strategy} disabled={busy !== null} onchange={() => { analysed = null; error = null; }}>
      <option value="adapt">Adapt template appearance — colours, typography and structure</option>
      <option value="layout">Layout only — keep the project design system</option>
    </select>
    <p class="text-xs text-base-content/75">Adaptation derives a visual system for this reference; the approved project design system stays available. For your own HTML, embed CSS to preserve its appearance. Scripts are not executed.</p>
  </div>

  {#if current}
    <div class="flex items-start justify-between gap-3 rounded-box border border-line p-3">
      <div class="min-w-0">
        <p class="mb-1 text-xs font-semibold text-base-content/80">In use</p>
        <LayoutReferenceSummary reference={current} />
      </div>
      {#if onRemove}
        <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={remove} disabled={busy !== null}>
          {#if busy === "remove"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Trash2 class="size-3.5" aria-hidden="true" />{/if}Remove
        </button>
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap gap-2" aria-label="Template source">
    <button type="button" class="btn btn-sm {mode === 'builtin' ? 'btn-active' : 'btn-outline'}" aria-pressed={mode === "builtin"} disabled={busy !== null} onclick={() => chooseMode("builtin")}>Draw with template</button>
    <button type="button" class="btn btn-sm {mode === 'own' ? 'btn-active' : 'btn-outline'}" aria-pressed={mode === "own"} disabled={busy !== null} onclick={() => chooseMode("own")}>Draw with your own template</button>
  </div>

  {#if mode === "builtin"}
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-2 sm:flex-row">
        <select class="select select-sm sm:w-48" aria-label="Template category" bind:value={category} disabled={busy !== null}>
          <option>All</option>
          {#each categories as c (c)}<option>{c}</option>{/each}
        </select>
        <input class="input input-sm w-full" type="search" aria-label="Search templates" placeholder="Search dashboards, login, store…" bind:value={search} disabled={busy !== null} />
      </div>
      <div class="flex items-center justify-between gap-2 text-xs text-base-content/70">
        <span aria-live="polite">{loadingCatalog ? "Reading template collection…" : `${catalog.length} templates · refreshed when opened`}</span>
        <button type="button" class="btn btn-ghost btn-xs" disabled={loadingCatalog || busy !== null} onclick={loadCatalog}>Refresh templates</button>
      </div>
      <div class="grid max-h-80 grid-cols-1 gap-3 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Built-in UI templates">
        {#each templates as template (template.id)}
          <button type="button" class="card card-border card-sm overflow-hidden text-left {templateId === template.id ? 'border-primary ring-1 ring-primary' : ''}" aria-pressed={templateId === template.id} disabled={busy !== null} onclick={() => { templateId = template.id; analysed = null; error = null; }}>
            <figure class="h-28 w-full bg-base-200">
              {#if template.hasPreview}<img class="h-full w-full object-cover object-top" src={`/ui-templates/${template.id}/preview?v=${template.previewVersion ?? 0}`} alt={`Preview of ${template.name}`} loading="lazy" />
              {:else}<span class="px-4 text-center text-xs text-base-content/60">Preview not generated yet<br />HTML available to analyse</span>{/if}
            </figure>
            <div class="card-body gap-1 p-3"><span class="text-sm font-semibold">{template.name}</span><span class="text-xs text-base-content/70">{template.category}</span></div>
          </button>
        {:else}
          <p class="text-sm text-base-content/70 sm:col-span-2 lg:col-span-3">No templates match. Try another category or search.</p>
        {/each}
      </div>
      {#if selected}
        <div class="rounded-box border border-base-300 p-3">
          <p class="text-sm font-semibold">Selected: {selected.name}</p>
          <p class="text-xs text-base-content/70">{selected.description}</p>
          {#if selected.hasPreview}<details class="mt-2"><summary class="cursor-pointer text-xs">Larger preview</summary><img class="mt-2 w-full rounded-field" src={`/ui-templates/${selected.id}/preview?v=${selected.previewVersion ?? 0}`} alt={`Larger preview of ${selected.name}`} /></details>{/if}
        </div>
      {/if}
      <p class="text-xs text-base-content/70">Preview shows the original example data. Generated screens use your product's own data and requirements. You can choose a different reference for an individual screen.</p>
      <button type="button" class="btn btn-sm btn-outline self-end" onclick={analyse} disabled={!selected || loadingCatalog || busy !== null} aria-busy={busy === "analyse"}>
        {#if busy === "analyse"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Reading the layout…{:else}<ScanSearch class="size-3.5" aria-hidden="true" />Analyse selected template{/if}
      </button>
    </div>
  {:else}
  <div class="flex flex-col gap-3">
    <label class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-base-content/80">Name <span class="font-normal text-base-content/75">(optional)</span></span>
      <input class="input input-sm w-full" maxlength="80" bind:value={name} oninput={() => (analysed = null)} placeholder="e.g. Admin dashboard template" />
    </label>
    <label class="flex flex-col gap-1.5">
      <span class="text-xs font-semibold text-base-content/80">Page HTML</span>
      <textarea
        class="textarea h-40 w-full font-mono text-xs"
        bind:value={html}
        oninput={() => (analysed = null)}
        placeholder={"<!doctype html>\n<html>…"}
        spellcheck="false"
      ></textarea>
    </label>
    <div class="flex flex-wrap items-center gap-2">
      <label class="btn btn-ghost btn-sm gap-1.5">
        <FileCode2 class="size-3.5" aria-hidden="true" />Pick an .html file
        <input type="file" accept=".html,.htm,text/html" class="sr-only" onchange={pickFile} />
      </label>
      <button type="button" class="btn btn-sm btn-outline ml-auto" onclick={analyse} disabled={!html.trim() || busy !== null} aria-busy={busy === "analyse"}>
        {#if busy === "analyse"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Reading the layout…{:else}<ScanSearch class="size-3.5" aria-hidden="true" />Analyse{/if}
      </button>
    </div>
  </div>
  {/if}

  {#if error}<Notice tone="error">{error}</Notice>{/if}

  {#if analysed}
    <section class="flex flex-col gap-3 rounded-box border border-primary-ink/40 p-3" aria-label="What the AI read">
      <p class="text-xs font-semibold text-base-content/80">What the AI read — check it before screens follow it</p>
      <LayoutReferenceSummary reference={analysed} full />
    </section>
  {/if}

  <div class="flex justify-end gap-2">
    <button type="button" class="btn btn-ghost" onclick={() => (open = false)} disabled={busy !== null}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={use} disabled={!analysed || busy !== null} aria-busy={busy === "use"}>
      {#if busy === "use"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}{useLabel}
    </button>
  </div>
</Modal>
