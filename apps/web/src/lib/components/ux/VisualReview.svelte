<script lang="ts">
  import { untrack } from "svelte";
  import type { UxReviewAspect, UxReviewStatus, UxScreen, UxVisualReview } from "$lib/types.js";

  /**
   * A person's visual review of the rendered screen (aturan.md §5.6): five
   * questions, each "Fits", "Needs revision" or "Not checked", with the
   * element at fault and a concrete change when it needs revision. Input for
   * the person's own decision — never a score, never a blocker. A review of an
   * older drawing says so.
   */
  let {
    screen,
    editing,
    busy,
    onSave,
  }: {
    screen: UxScreen;
    editing: boolean;
    busy: string | null;
    onSave: (aspects: UxVisualReview["aspects"]) => Promise<boolean>;
  } = $props();

  const ASPECTS: Array<{ aspect: UxReviewAspect; label: string; question: string }> = [
    { aspect: "focus", label: "Focus", question: "Is the main job and the next action visible at once?" },
    { aspect: "composition", label: "Composition", question: "Do the areas follow how the content relates, rather than filling cards?" },
    { aspect: "hierarchy", label: "Hierarchy", question: "Are main information, support and metadata easy to tell apart?" },
    { aspect: "product_fit", label: "Product fit", question: "Do the words, density, media and navigation fit the users and the brief?" },
    { aspect: "devices", label: "Devices & consistency", question: "Does everything stay reachable on the supported sizes, and feel like one product with the other screens?" },
  ];
  const STATUS: Array<{ value: UxReviewStatus; label: string }> = [
    { value: "ok", label: "Fits" },
    { value: "revise", label: "Needs revision" },
    { value: "unchecked", label: "Not checked" },
  ];

  type Row = { aspect: UxReviewAspect; status: UxReviewStatus; element: string; change: string };
  const fromScreen = (s: UxScreen): Row[] =>
    ASPECTS.map(({ aspect }) => {
      const saved = s.visual_review?.aspects.find((a) => a.aspect === aspect);
      return { aspect, status: saved?.status ?? "unchecked", element: saved?.element ?? "", change: saved?.change ?? "" };
    });

  let rows = $state<Row[]>(untrack(() => fromScreen(screen)));
  // Another screen, or a newly saved review, resets the form to what is stored.
  let shownFor = untrack(() => `${screen.key}|${screen.visual_review?.reviewed_at ?? ""}`);
  $effect(() => {
    const id = `${screen.key}|${screen.visual_review?.reviewed_at ?? ""}`;
    if (id !== shownFor) {
      shownFor = id;
      rows = fromScreen(screen);
    }
  });

  const review = $derived(screen.visual_review);
  const counts = $derived({
    ok: (review?.aspects ?? []).filter((a) => a.status === "ok").length,
    revise: (review?.aspects ?? []).filter((a) => a.status === "revise").length,
  });
  const dirty = $derived(JSON.stringify(rows) !== JSON.stringify(fromScreen(screen)));
  const incomplete = $derived(rows.some((r) => r.status === "revise" && !r.change.trim()));
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

  async function save() {
    const aspects = rows.map((r) => ({ ...r, element: r.element.trim().slice(0, 200), change: r.change.trim().slice(0, 500) }));
    await onSave(aspects);
  }
</script>

<details class="collapse collapse-arrow rounded-box border border-line" open={Boolean(review?.outdated) || undefined}>
  <summary class="collapse-title min-h-0 py-2.5 pe-9 ps-3 text-[13px] font-semibold">
    Visual review
    <span class="font-normal text-base-content/75">
      {#if review}· {counts.ok} fit{#if counts.revise}, {counts.revise} need revision{/if}{:else}· not reviewed{/if}
    </span>
  </summary>
  <div class="collapse-content flex flex-col gap-3 px-3 text-[13px]">
    <p class="text-xs text-base-content/80">Judge the rendered screen, not the classes. For your decision only: it never blocks approval and is not a score.</p>
    {#if review?.outdated}
      <p class="text-xs font-medium text-warn" role="status">Outdated — the drawing changed since this review.</p>
    {:else if review}
      <p class="text-xs text-base-content/75">Reviewed {when.format(new Date(review.reviewed_at))}.</p>
    {/if}

    {#each ASPECTS as a, i (a.aspect)}
      {@const row = rows[i]!}
      <fieldset class="flex flex-col gap-1.5 border-t border-line pt-2.5 first-of-type:border-t-0 first-of-type:pt-0" disabled={!editing || busy !== null}>
        <legend class="contents">
          <span class="block font-semibold text-base-content">{a.label}</span>
        </legend>
        <p class="text-xs text-base-content/80">{a.question}</p>
        <div class="join w-full" role="radiogroup" aria-label={`${a.label}: result`}>
          {#each STATUS as s (s.value)}
            <label class="btn btn-xs join-item flex-1 font-medium {row.status === s.value ? 'btn-active' : ''}">
              <input class="sr-only" type="radio" name={`review-${screen.key}-${a.aspect}`} value={s.value} bind:group={rows[i]!.status} />{s.label}
            </label>
          {/each}
        </div>
        {#if row.status === "revise"}
          <input class="input input-sm w-full" maxlength="200" placeholder="Which element (e.g. the order panel)" aria-label={`${a.label}: element`} bind:value={rows[i]!.element} />
          <textarea class="textarea textarea-sm min-h-[52px] w-full" maxlength="500" placeholder="The concrete change (e.g. keep the order total visible while scrolling)" aria-label={`${a.label}: change`} bind:value={rows[i]!.change}></textarea>
        {/if}
      </fieldset>
    {/each}

    {#if editing}
      <div class="flex items-center justify-end gap-2">
        {#if incomplete}<span class="me-auto text-xs text-base-content/75">Say what to change where it needs revision.</span>{/if}
        <button type="button" class="btn btn-sm" onclick={save} disabled={busy !== null || (!dirty && !review?.outdated) || incomplete}>
          {#if busy === "review"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}Save review
        </button>
      </div>
    {/if}
  </div>
</details>
