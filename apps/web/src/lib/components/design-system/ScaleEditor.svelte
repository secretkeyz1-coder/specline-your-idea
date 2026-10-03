<script lang="ts">
  import { RotateCcw } from "lucide-svelte";
  import type { DesignSystemSpec, DsScale } from "$lib/types.js";

  /**
   * The structural scale behind the token contract: type sizes, leading,
   * display tracking, section spacing, container, motion. An empty field
   * follows the derived value (from density, radius and direction), shown as
   * its placeholder; typing a value overrides it within the schema's bounds.
   */
  let {
    spec = $bindable(),
    effective,
  }: {
    spec: DesignSystemSpec;
    /** Token → value as the live tokens.css declares it ("--text-base" → "15px"). */
    effective: Record<string, string>;
  } = $props();

  type Group = "text" | "section_y" | "gutter" | "motion";
  type Field = {
    /** Where the override lives: a top-level key, or a group and its key. */
    key: string;
    group?: Group;
    label: string;
    token: string;
    min: number;
    max: number;
    /** Whole numbers only (px and ms), else a step for decimals. */
    int: boolean;
    unit: string;
  };

  const TEXT: Field[] = (
    [
      ["xs", 10, 16, "Caption"],
      ["sm", 11, 18, "Small"],
      ["base", 13, 22, "Body"],
      ["lg", 15, 30, "Large"],
      ["xl", 17, 44, "H2"],
      ["2xl", 20, 64, "Section"],
      ["3xl", 24, 96, "H1"],
      ["4xl", 28, 200, "Display"],
    ] as const
  ).map(([key, min, max, label]) => ({ key, group: "text", label: `${label} (${key})`, token: `--text-${key}`, min, max, int: true, unit: "px" }));

  const RHYTHM: Field[] = [
    { key: "leading_body", label: "Body leading", token: "--leading-body", min: 1.2, max: 2, int: false, unit: "" },
    { key: "leading_tight", label: "Heading leading", token: "--leading-tight", min: 0.9, max: 1.5, int: false, unit: "" },
    { key: "tracking_display", label: "Display tracking", token: "--tracking-display", min: -0.08, max: 0.05, int: false, unit: "em" },
  ];

  const LAYOUT: Field[] = [
    { key: "desktop", group: "section_y", label: "Section gap, desktop", token: "--section-y-desktop", min: 16, max: 200, int: true, unit: "px" },
    { key: "tablet", group: "section_y", label: "Section gap, tablet", token: "--section-y-tablet", min: 12, max: 160, int: true, unit: "px" },
    { key: "phone", group: "section_y", label: "Section gap, phone", token: "--section-y-phone", min: 8, max: 120, int: true, unit: "px" },
    { key: "container_max", label: "Container width", token: "--container-max", min: 640, max: 2000, int: true, unit: "px" },
    { key: "desktop", group: "gutter", label: "Gutter, desktop", token: "--container-gutter-desktop", min: 8, max: 96, int: true, unit: "px" },
    { key: "tablet", group: "gutter", label: "Gutter, tablet", token: "--container-gutter-tablet", min: 8, max: 64, int: true, unit: "px" },
    { key: "phone", group: "gutter", label: "Gutter, phone", token: "--container-gutter-phone", min: 8, max: 48, int: true, unit: "px" },
  ];

  const MOTION: Field[] = [
    { key: "fast", group: "motion", label: "Motion, fast", token: "--motion-fast", min: 0, max: 1000, int: true, unit: "ms" },
    { key: "base", group: "motion", label: "Motion, base", token: "--motion-base", min: 0, max: 1000, int: true, unit: "ms" },
  ];

  const SECTIONS: Array<{ title: string; fields: Field[] }> = [
    { title: "Type scale", fields: TEXT },
    { title: "Rhythm", fields: RHYTHM },
    { title: "Layout", fields: LAYOUT },
    { title: "Motion", fields: MOTION },
  ];

  /** Text typed but not (yet) a valid value, per field, so it can be flagged without being saved. */
  let drafts = $state<Record<string, string>>({});
  const id = (f: Field) => `scale-${f.group ?? "top"}-${f.key}`;

  function current(f: Field): number | undefined {
    const s = spec.scale;
    if (!s) return undefined;
    if (f.group) return (s[f.group] as Record<string, number> | undefined)?.[f.key];
    return s[f.key as keyof DsScale] as number | undefined;
  }

  /** Writes or clears one override, dropping empty groups so the spec stays tidy. */
  function write(f: Field, value: number | undefined) {
    const next: DsScale = structuredClone($state.snapshot(spec.scale ?? {})) as DsScale;
    if (f.group) {
      const group = { ...((next[f.group] as Record<string, number> | undefined) ?? {}) };
      if (value === undefined) delete group[f.key];
      else group[f.key] = value;
      if (Object.keys(group).length) (next as Record<string, unknown>)[f.group] = group;
      else delete next[f.group];
    } else if (value === undefined) {
      delete (next as Record<string, unknown>)[f.key];
    } else {
      (next as Record<string, unknown>)[f.key] = value;
    }
    if (Object.keys(next).length) spec.scale = next;
    else delete spec.scale;
  }

  function onInput(f: Field, raw: string) {
    const text = raw.trim();
    if (!text) {
      delete drafts[id(f)];
      write(f, undefined);
      return;
    }
    const n = Number(text);
    const ok = Number.isFinite(n) && n >= f.min && n <= f.max && (!f.int || Number.isInteger(n));
    if (ok) {
      delete drafts[id(f)];
      write(f, n);
    } else {
      drafts[id(f)] = text;
    }
  }

  function reset() {
    drafts = {};
    delete spec.scale;
  }

  /** The derived value for the placeholder: the token as tokens.css declares it, without its unit. */
  const placeholder = (f: Field) => effective[f.token]?.replace(/(px|ms|em)$/, "") ?? "";
  const overridden = $derived(Boolean(spec.scale && Object.keys(spec.scale).length));
  const invalid = $derived(Object.keys(drafts).length);
</script>

<fieldset class="flex flex-col gap-3">
  <legend class="mb-1.5 flex w-full items-center justify-between gap-2 text-[13px] font-medium text-base-content/80">
    Scale
    {#if overridden}
      <button type="button" class="btn btn-ghost btn-xs max-sm:h-11" onclick={reset}><RotateCcw class="size-3" aria-hidden="true" />Reset to derived</button>
    {/if}
  </legend>
  <p class="text-xs leading-relaxed text-base-content/80">
    Empty fields follow density, radius and the visual direction (shown greyed). Type a value to override it.
  </p>
  {#each SECTIONS as section (section.title)}
    <div class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold text-base-content/80">{section.title}</h3>
      <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-2">
        {#each section.fields as f (id(f))}
          {@const bad = drafts[id(f)] !== undefined}
          <label class="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 text-xs text-base-content/80" for={id(f)}>
            <span class="truncate" title={f.token}>{f.label}</span>
            <span class="input input-sm w-full gap-1 pe-2 max-sm:h-11 {bad ? 'input-error' : ''}">
              <input
                id={id(f)}
                class="min-w-0 grow font-mono text-xs text-base-content"
                inputmode="decimal"
                placeholder={placeholder(f)}
                value={drafts[id(f)] ?? current(f) ?? ""}
                aria-invalid={bad}
                aria-describedby={bad ? `${id(f)}-range` : undefined}
                oninput={(e) => onInput(f, e.currentTarget.value)}
              />
              {#if f.unit}<span class="shrink-0 text-base-content/75" aria-hidden="true">{f.unit}</span>{/if}
            </span>
          </label>
          {#if bad}
            <p id="{id(f)}-range" class="col-span-2 text-xs text-danger">
              {f.label}: {f.int ? "a whole number" : "a number"} from {f.min} to {f.max}{f.unit ? ` ${f.unit}` : ""}.
            </p>
          {/if}
        {/each}
      </div>
    </div>
  {/each}
  {#if invalid}
    <p class="text-xs text-base-content/80" role="status">Values out of range are not used until they are fixed.</p>
  {/if}
</fieldset>
