<script lang="ts">
  import { OctagonAlert, TriangleAlert } from "lucide-svelte";
  import type { StackPackage, StackVerification } from "$lib/types.js";

  /**
   * One quiet line with what the registry said about a layer's technology:
   * "v2.40.0 · released 20 Sep 2026", or a warning when it is stale or
   * deprecated (with the source to check). Nothing when it was never checked.
   */
  let {
    verified,
    versionConstraint = null,
    pkg = null,
    technology = "",
  }: {
    verified: StackVerification | null | undefined;
    versionConstraint?: string | null;
    /** The package that was checked; named when it isn't obviously the technology ("Auth.js" is checked as @auth/core). */
    pkg?: StackPackage | null;
    technology?: string;
  } = $props();
  const plain = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const checkedAs = $derived(pkg && plain(pkg.name) !== plain(technology) ? pkg.name : null);

  const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const fmt = (d: string | null | undefined) => {
    const t = d ? Date.parse(d) : NaN;
    return Number.isFinite(t) ? day.format(new Date(t)) : null;
  };
  const released = $derived(fmt(verified?.released_at));
  const checked = $derived(fmt(verified?.checked_at));
  const title = $derived(checked ? `Checked ${checked} against the package registry` : undefined);
</script>

{#if verified && verified.status === "deprecated"}
  <span class="flex flex-wrap items-center gap-x-1.5 text-xs text-danger" {title}>
    <OctagonAlert class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="font-semibold">Deprecated</span>{#if verified.note}<span class="text-base-content/80">· {verified.note}</span>{/if}
    {#if verified.source_url}<a class="underline underline-offset-2" href={verified.source_url} target="_blank" rel="noopener noreferrer">Source</a>{/if}
  </span>
{:else if verified && verified.status === "stale"}
  <span class="flex flex-wrap items-center gap-x-1.5 text-xs text-warn" {title}>
    <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="font-semibold">No release since {released ?? "a long time"}</span>
    {#if verified.source_url}<a class="underline underline-offset-2" href={verified.source_url} target="_blank" rel="noopener noreferrer">Source</a>{/if}
  </span>
{:else if verified && verified.status === "current"}
  <span class="text-xs text-base-content/75 tabular-nums" {title}>
    {#if versionConstraint}<span class="font-mono">{versionConstraint}</span> · {/if}{#if checkedAs}<span class="font-mono">{checkedAs}</span> {/if}{#if verified.latest_version}latest <span class="font-mono">{verified.latest_version}</span>{#if released} · {released}{/if}{:else if released}last release {released}{/if}{#if checked}<span class="max-sm:hidden"> · checked {checked}</span>{/if}
    {#if verified.note}<span class="block text-base-content/75">{verified.note}</span>{/if}
  </span>
{:else if versionConstraint}
  <span class="font-mono text-xs text-base-content/75">{versionConstraint}</span>
{/if}
