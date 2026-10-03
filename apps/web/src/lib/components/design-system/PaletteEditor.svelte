<script lang="ts">
  import { Moon, Sun, TriangleAlert } from "lucide-svelte";
  import { hexInput } from "$lib/ds-color.js";
  import { DS_COLOR_TOKENS, type DesignSystemSpec, type DsColorToken, type DsContrastCheck } from "$lib/types.js";

  /**
   * Every colour role of both modes, each a picker plus its hex. A role that
   * fails a contrast pair (from the live preview's checks, which the API makes)
   * says which pair and by how much.
   */
  let {
    spec = $bindable(),
    checks,
    onAccent,
  }: {
    spec: DesignSystemSpec;
    checks: DsContrastCheck[];
    /** The light accent changed here: the brand-colour field follows it. */
    onAccent?: (hex: string) => void;
  } = $props();

  const LABEL: Record<DsColorToken, string> = {
    bg: "Page background",
    surface: "Cards and panels",
    surface2: "Subtle fills",
    fg: "Text",
    fgMuted: "Secondary text",
    border: "Dividers",
    borderStrong: "Control edges",
    accent: "Accent",
    accentFg: "Text on accent",
    success: "Success",
    warn: "Warning",
    danger: "Danger",
    info: "Info",
  };

  let mode = $state<"light" | "dark">("light");

  function set(k: DsColorToken, hex: string) {
    spec[mode] = { ...spec[mode], [k]: hex };
    if (k === "accent" && mode === "light") onAccent?.(hex);
  }

  const failing = (k: DsColorToken) => checks.filter((c) => c.mode === mode && !c.ok && c.foreground === k);
</script>

<div class="flex flex-col gap-3">
  <div class="join self-start" role="group" aria-label="Colour mode to edit">
    <button type="button" class="btn btn-sm join-item {mode === 'light' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={mode === "light"} onclick={() => (mode = "light")}>
      <Sun class="size-3.5" aria-hidden="true" />Light
    </button>
    <button type="button" class="btn btn-sm join-item {mode === 'dark' ? 'btn-active' : 'font-normal text-base-content/80'}" aria-pressed={mode === "dark"} onclick={() => (mode = "dark")}>
      <Moon class="size-3.5" aria-hidden="true" />Dark
    </button>
  </div>
  <ul class="flex flex-col gap-2" aria-label="{mode === 'light' ? 'Light' : 'Dark'} mode colours">
    {#each DS_COLOR_TOKENS as k (k)}
      {@const bad = failing(k)}
      <li class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <label for="ds-{mode}-{k}" class="min-w-0 grow truncate text-[13px] text-base-content">
            {LABEL[k]}
            {#if bad.length}<TriangleAlert class="ms-1 inline size-3.5 text-warn" aria-hidden="true" /><span class="sr-only"> (too hard to read)</span>{/if}
          </label>
          <input
            type="color"
            class="h-9 w-10 shrink-0 cursor-pointer rounded-field border border-line-control bg-base-100 p-1 max-sm:h-11"
            aria-label="Pick {LABEL[k].toLowerCase()} ({mode})"
            value={spec[mode][k]}
            oninput={(e) => set(k, e.currentTarget.value.toLowerCase())}
          />
          <!-- Typed hex applies once complete; an unfinished value goes back on leaving the field. -->
          <input
            id="ds-{mode}-{k}"
            class="input input-sm w-[5.75rem] shrink-0 font-mono text-xs max-sm:h-11"
            maxlength="7"
            spellcheck="false"
            value={spec[mode][k]}
            oninput={(e) => {
              const hex = hexInput(e.currentTarget.value);
              if (hex && e.currentTarget.value.replace("#", "").length === 6) set(k, hex);
            }}
            onchange={(e) => {
              const hex = hexInput(e.currentTarget.value);
              if (hex) set(k, hex);
              e.currentTarget.value = spec[mode][k];
            }}
          />
        </div>
        {#if bad.length}
          <p class="text-xs text-warn">
            {bad.map((f) => `${f.ratio}:1 on ${LABEL[f.background].toLowerCase()}, needs ${f.minimum}:1`).join(" · ")}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
</div>
