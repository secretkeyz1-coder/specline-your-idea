<script lang="ts">
  import { ChevronDown, FileUp, Undo2, Wand2 } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { DesignSystemSpec, DsConfidenceLevel, DsImportConfidence, DsTokenLayer } from "$lib/types.js";

  /**
   * Bring your own design system: paste (or pick a file with) CSS variables,
   * a Tailwind / daisyUI / shadcn theme, a tokens JSON or a DESIGN.md. The API
   * reads it into a complete spec that replaces the editor's values, so the
   * live preview shows it at once; nothing is saved until "Save draft".
   */
  type ImportResult = {
    spec: DesignSystemSpec;
    source: "tokens" | "ai" | "mixed";
    notes: string[];
    unmapped: string[];
    /** How each contract token was bound, with a score and grade (absent from older APIs). */
    confidence?: DsImportConfidence;
  };

  let {
    projectId,
    current,
    onApply,
  }: {
    projectId: string;
    /** The editor's values now: kept so the import can be undone. */
    current: DesignSystemSpec;
    onApply: (spec: DesignSystemSpec) => void;
  } = $props();

  const MAX = 60_000;
  const SOURCE: Record<ImportResult["source"], string> = {
    tokens: "read straight from the tokens",
    ai: "read by the AI from the text",
    mixed: "tokens read directly, the text by the AI",
  };

  /* ── Token report: the weakest bindings first, grouped by contract layer. ── */
  const GRADE: Record<DsImportConfidence["grade"], { label: string; cls: string }> = {
    excellent: { label: "Excellent", cls: "border-mint/40 bg-mint-soft text-mint" },
    usable: { label: "Usable", cls: "border-sky/40 bg-sky-soft text-sky" },
    "needs-review": { label: "Needs review", cls: "border-warn/40 bg-warn-soft text-warn" },
    "needs-rebuild": { label: "Needs rebuild", cls: "border-danger/40 bg-danger-soft text-danger" },
  };
  const LEVEL: Record<DsConfidenceLevel, { rank: number; label: string; cls: string }> = {
    low: { rank: 0, label: "Low — default", cls: "text-danger" },
    fallback: { rank: 1, label: "Fallback", cls: "text-warn" },
    alias: { rank: 2, label: "Alias", cls: "text-base-content/80" },
    medium: { rank: 3, label: "Medium — by role", cls: "text-base-content" },
    high: { rank: 4, label: "High — exact name", cls: "text-mint" },
  };
  const LAYERS: Array<{ id: DsTokenLayer; label: string }> = [
    { id: "A1-identity", label: "Identity" },
    { id: "A1-structure", label: "Structure" },
    { id: "A2", label: "Defaults" },
    { id: "B-slot", label: "Slots" },
    { id: "extension", label: "Extensions" },
  ];
  const layersOf = (c: DsImportConfidence) =>
    LAYERS.map((l) => ({
      ...l,
      tokens: c.tokens.filter((t) => t.layer === l.id).sort((a, b) => LEVEL[a.confidence].rank - LEVEL[b.confidence].rank || a.token.localeCompare(b.token)),
    })).filter((l) => l.tokens.length);
  const weak = (c: DsImportConfidence) => c.tokens.filter((t) => t.confidence === "low" || t.confidence === "fallback").length;

  let open = $state(false);
  let text = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let result = $state<ImportResult | null>(null);
  let before = $state<DesignSystemSpec | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function pickFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX * 4) {
      error = "That file is too large. Pick the tokens or theme file, or paste the relevant part.";
      return;
    }
    error = null;
    text = (await file.text()).slice(0, MAX);
  }

  async function apply() {
    busy = true;
    error = null;
    try {
      const res = await fetch(`/projects/${projectId}/design-system/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, component_library: current.component_library }),
      });
      const payload = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { message?: string };
      if (!res.ok || !payload.spec) {
        error = payload.message ?? "The design system could not be read. Try again.";
        return;
      }
      before = structuredClone($state.snapshot(current));
      result = payload as ImportResult;
      onApply(structuredClone(payload.spec));
    } catch {
      error = "The connection dropped. Try again.";
    } finally {
      busy = false;
    }
  }

  function undo() {
    if (!before) return;
    onApply(before);
    before = null;
    result = null;
  }
</script>

<details class="group rounded-box border border-line bg-base-100" bind:open>
  <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
    <Wand2 class="size-4 shrink-0 text-base-content/80" aria-hidden="true" />
    <span class="grow">Bring your own design system</span>
    <ChevronDown class="size-4 shrink-0 text-base-content/80 transition-transform group-open:rotate-180" aria-hidden="true" />
  </summary>
  <div class="flex flex-col gap-3 border-t border-line px-3.5 pt-3 pb-3.5">
    <p class="text-xs leading-relaxed text-base-content/80">
      Paste CSS variables, a Tailwind, daisyUI or shadcn/ui theme, a design-tokens JSON, or a DESIGN.md or description. The preview switches to it; nothing is saved until you save the draft.
    </p>
    <label class="flex flex-col gap-1.5">
      <span class="sr-only">Your design system</span>
      <textarea
        class="textarea h-44 w-full font-mono text-xs leading-relaxed"
        maxlength={MAX}
        spellcheck="false"
        placeholder={":root {\n  --background: #ffffff;\n  --foreground: #0f172a;\n  --primary: #2563eb;\n}"}
        bind:value={text}
      ></textarea>
    </label>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} type="file" accept=".css,.scss,.json,.md,.markdown,.txt" class="sr-only" tabindex="-1" onchange={pickFile} />
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => fileInput?.click()} disabled={busy}>
        <FileUp class="size-3.5" aria-hidden="true" />Pick a file
      </button>
      <span class="grow text-xs tabular-nums text-base-content/75">{text.length.toLocaleString("en")} / {MAX.toLocaleString("en")}</span>
      <button type="button" class="btn btn-primary btn-sm" onclick={apply} disabled={busy || !text.trim()} aria-busy={busy}>
        {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Reading…{:else}Apply{/if}
      </button>
    </div>
    {#if busy}
      <p class="text-xs text-base-content/80" role="status">Tokens read at once; a written description goes to the AI and can take a minute.</p>
    {/if}
    {#if error}<Notice tone="error">{error}</Notice>{/if}
    {#if result}
      <div class="flex flex-col gap-2.5" role="status">
        <Notice tone="success">
          Applied “{result.spec.name}”, {SOURCE[result.source]}. Check the preview, adjust anything below, then save the draft.
        </Notice>
        {#if result.notes.length}
          <div class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold text-base-content/80">What happened</h3>
            <ul class="flex list-disc flex-col gap-0.5 ps-4 text-xs leading-relaxed text-base-content/80">
              {#each result.notes as note, i (i)}<li>{note}</li>{/each}
            </ul>
          </div>
        {/if}
        {#if result.confidence}
          {@const c = result.confidence}
          <div class="flex flex-col gap-1.5">
            <h3 class="flex flex-wrap items-center gap-2 text-xs font-semibold text-base-content/80">
              Token match
              <span class="font-mono font-normal tabular-nums">{c.score}/100</span>
              <span class="badge badge-sm font-semibold {GRADE[c.grade].cls}">{GRADE[c.grade].label}</span>
            </h3>
            {#if c.recommend_rebuild}
              <Notice tone="warn">Rebuild recommended: too many tokens are defaults rather than read from your system. Paste the full token or theme file, or adjust the colours below.</Notice>
            {/if}
            <details class="group/tokens">
              <summary class="btn btn-ghost btn-xs -ml-2 list-none font-normal max-sm:h-9 [&::-webkit-details-marker]:hidden">
                <ChevronDown class="size-3 -rotate-90 transition-transform group-open/tokens:rotate-0" aria-hidden="true" />
                All {c.tokens.length} tokens{weak(c) ? ` · ${weak(c)} defaulted` : ""}
              </summary>
              <div class="mt-1.5 flex flex-col gap-2">
                {#each layersOf(c) as layer (layer.id)}
                  <table class="w-full table-fixed text-xs">
                    <caption class="pb-0.5 text-left font-semibold text-base-content/80">{layer.label}</caption>
                    <thead class="sr-only"><tr><th scope="col">Token</th><th scope="col">Confidence</th><th scope="col">From</th></tr></thead>
                    <tbody>
                      {#each layer.tokens as t (t.token)}
                        <tr class="border-t border-line">
                          <td class="w-[42%] truncate py-0.5 pe-2 font-mono" title={t.token}>{t.token}</td>
                          <td class="w-[30%] py-0.5 pe-2 {LEVEL[t.confidence].cls}">{LEVEL[t.confidence].label}</td>
                          <td class="truncate py-0.5 font-mono text-base-content/75" title={t.from ?? ""}>{t.from ?? "—"}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/each}
              </div>
            </details>
          </div>
        {/if}
        {#if result.unmapped.length}
          <div class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold text-base-content/80">Kept as notes for the agent</h3>
            <p class="text-xs text-base-content/75">The preview can't show these; they are in the guidance under “Imported notes”.</p>
            <ul class="flex list-disc flex-col gap-0.5 ps-4 text-xs leading-relaxed text-base-content/80">
              {#each result.unmapped as item, i (i)}<li class="break-words">{item}</li>{/each}
            </ul>
          </div>
        {/if}
        {#if before}
          <button type="button" class="btn btn-ghost btn-sm self-start" onclick={undo}><Undo2 class="size-3.5" aria-hidden="true" />Undo import</button>
        {/if}
      </div>
    {/if}
  </div>
</details>
