<script lang="ts">
  import { Check, Copy } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { DsPackage } from "$lib/types.js";

  /**
   * What the agent gets: the live design-system package (USAGE.md, DESIGN.md,
   * tokens.css, design-tokens.json, craft references) for the values on
   * screen, one file at a time in a read-only viewer with a copy button.
   */
  let {
    pkg,
    loading,
    error,
  }: {
    pkg: DsPackage | null;
    loading: boolean;
    error: string | null;
  } = $props();

  const ORDER: Record<DsPackage["files"][number]["role"], number> = { usage: 0, design: 1, tokens: 2, "design-tokens": 3, craft: 4, other: 5 };
  const files = $derived([...(pkg?.files ?? [])].sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.path.localeCompare(b.path)));
  let chosen = $state<string | null>(null);
  // The chosen file survives a refresh of the package while its path still exists.
  const file = $derived(files.find((f) => f.path === chosen) ?? files[0] ?? null);
  const name = (path: string) => path.split("/").pop() ?? path;

  let copied = $state(false);
  let copyError = $state<string | null>(null);
  async function copy() {
    if (!file) return;
    copyError = null;
    try {
      await navigator.clipboard.writeText(file.content);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copyError = "Your browser blocked clipboard access — select the text and copy it by hand.";
    }
  }
</script>

<div class="flex flex-col gap-2.5 text-[13px]">
  <p class="text-base-content/80">
    <code class="font-mono">sddctl ui pull</code> writes these into <code class="font-mono">docs/design-system/</code>; the screens and tasks are drawn and built from them.
    <span aria-live="polite">{loading ? "Updating…" : ""}</span>
  </p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if files.length}
    <div class="flex flex-wrap gap-1" role="tablist" aria-label="Package files">
      {#each files as f (f.path)}
        {@const on = file?.path === f.path}
        <button
          type="button"
          role="tab"
          aria-selected={on}
          aria-controls="package-file"
          class="btn btn-xs font-mono font-normal max-sm:h-9 {on ? 'btn-active' : 'btn-ghost text-base-content/80'}"
          title={f.path}
          onclick={() => (chosen = f.path)}>{f.role === "craft" ? `craft/${name(f.path)}` : name(f.path)}</button
        >
      {/each}
    </div>
    {#if file}
      <div id="package-file" role="tabpanel" class="relative overflow-hidden rounded-box border border-line bg-base-200">
        <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
          <code class="min-w-0 truncate font-mono text-xs text-base-content/80">{file.path}</code>
          <button type="button" class="btn btn-ghost btn-xs shrink-0 max-sm:h-9" onclick={copy} aria-label={copied ? `Copied ${name(file.path)}` : `Copy ${name(file.path)}`}>
            {#if copied}<Check class="size-3.5 text-mint" aria-hidden="true" />Copied{:else}<Copy class="size-3.5" aria-hidden="true" />Copy{/if}
          </button>
        </div>
        <!-- Focusable so the file can be scrolled from the keyboard. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <pre class="max-h-[420px] overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-base-content" tabindex="0" aria-label={file.path}>{file.content}</pre>
      </div>
    {/if}
    {#if copyError}<Notice tone="error">{copyError}</Notice>{/if}
  {:else if loading}
    <p class="text-base-content/80">Building the package…</p>
  {:else if !error}
    <p class="text-base-content/80">The package appears here once the design system is set.</p>
  {/if}
</div>
