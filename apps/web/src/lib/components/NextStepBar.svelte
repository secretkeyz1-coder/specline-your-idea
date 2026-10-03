<script lang="ts">
  import { enhance } from "$app/forms";
  import { afterNavigate, goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { ArrowRight, ChevronDown, CircleCheck, X } from "lucide-svelte";
  import Dropdown from "$lib/components/ui/Dropdown.svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import type { Journey, JourneyAction } from "$lib/journey.js";
  import AiProgress from "./AiProgress.svelte";
  import { runOf, setRun } from "$lib/generation.svelte.js";

  /**
   * The project's one next step — the single implementation behind both the
   * compact bar under the project tabs and the journey panel on the Plan page.
   * It replaces one-off "Next:" notices that a reload lost: the way forward is
   * always derived from the project itself, wherever the user is.
   *
   * The bar is an <aside> with a plain-text title, so each page's own <h1>
   * stays its first heading; the panel (Plan) is part of the page's content.
   */
  let {
    journey,
    projectId,
    variant = "bar",
    note = "",
    level = 2,
    prominent = false,
  }: {
    journey: Journey;
    projectId: string;
    variant?: "bar" | "panel" | "inline";
    /** Panel: where the chapter stands ("v1 draft"), appended to the chapter line instead of a second heading. */
    note?: string;
    /** Panel: the heading level of the step's title in the page's outline. */
    level?: 2 | 3;
    /** Inline: the step is the page's one primary button (a page with no button of its own, like the UI-reference canvas once approved). */
    prominent?: boolean;
  } = $props();

  // Inline variant: the step sits in the project tab row and its explanation
  // opens in a popover, so the pages under it keep their height for content.
  let popoverOpen = $state(false);
  // Phones: the step lives in a bar at the bottom, in thumb reach; its detail opens as a bottom sheet.
  let sheetOpen = $state(false);
  // The sheet belongs to the page it was opened on: a link in it, or landing on a result, closes it.
  afterNavigate(() => (sheetOpen = false));
  const onPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;
  function openDetail() {
    if (onPhone()) sheetOpen = true;
    else popoverOpen = true;
  }

  const next = $derived(journey.next);
  const finished = $derived(journey.finished);
  // The chapter the next action belongs to: named with its number, so the step and the spine agree.
  const chapter = $derived(journey.milestones[journey.step - 1] ?? null);
  const stepText = $derived(finished ? "Done" : `Chapter ${journey.step} of ${journey.total}${chapter ? ` · ${chapter.label}` : ""}`);

  // Already on the page the step points to: say where you are, don't send the
  // user to the same page again.
  const here = $derived.by(() => {
    if (!next.href) return false;
    const target = new URL(next.href, page.url.origin);
    if (target.pathname !== page.url.pathname) return false;
    const tab = target.searchParams.get("tab");
    return !tab || tab === (page.url.searchParams.get("tab") ?? "requirements");
  });
  const secondaryHere = $derived(
    Boolean(next.secondary?.href) && new URL(next.secondary!.href!, page.url.origin).pathname === page.url.pathname,
  );

  // In-flight generation is shared by every bar of this project (see
  // $lib/generation.svelte.ts): a second press elsewhere cannot start a second
  // paid run, and every bar shows the one that is running.
  const genRun = $derived(runOf(projectId));
  const busy = $derived<JourneyAction | null>(genRun.running?.action ?? null);
  const error = $derived(genRun.error);
  const AFTER: Record<JourneyAction, string> = {
    "?/generateDesign": "docs?tab=design",
    "?/generateTasks": "tasks",
  };
  const PROGRESS: Record<JourneyAction, { button: string; label: string; estimate: string }> = {
    "?/generateDesign": { button: "Generating design…", label: "Writing the technical design", estimate: "about a minute" },
    "?/generateTasks": { button: "Generating tasks…", label: "Breaking the design into tasks", estimate: "about two minutes" },
  };
  const DONE: Record<JourneyAction, string> = {
    "?/generateDesign": "The technical design is ready.",
    "?/generateTasks": "The tasks are ready.",
  };

  // The "ready" offer has done its job once the user is on the result.
  $effect(() => {
    const done = genRun.done;
    if (done && page.url.pathname === `/projects/${projectId}/${AFTER[done.action].split("?")[0]}`) setRun(projectId, { done: null });
  });

  function run(action: JourneyAction) {
    return ({ cancel }: { cancel: () => void }) => {
      // Already running (started from this bar or another one): never a second paid call.
      if (runOf(projectId).running) {
        cancel();
        return;
      }
      const from = page.url.pathname + page.url.search;
      setRun(projectId, { running: { action, from }, error: null, done: null });
      // Inline: the progress shows in the popover (the bottom sheet on phones).
      if (variant === "inline") openDetail();
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        const pid = projectId;
        if (result.type === "success" || result.type === "redirect") {
          // Land on what was just made — but only if the user is still where
          // they pressed the button. Anywhere else, a finished run must not
          // yank them away: refresh the data and offer the result instead.
          const stillThere = page.url.pathname + page.url.search === from;
          setRun(pid, { running: null, done: stillThere ? null : { action } });
          if (stillThere) await goto(`/projects/${pid}/${AFTER[action]}`, { invalidateAll: true });
          else await invalidateAll();
        } else {
          setRun(pid, { running: null, error: (result.data?.message as string | undefined) ?? "That didn't work. Try again in a moment." });
          // Inline: the message lives in the popover — open it so it is seen.
          if (variant === "inline") openDetail();
          await invalidateAll();
        }
      };
    };
  }
</script>

{#snippet secondaryAction(cls: string)}
  {#if next.secondary?.action}
    <form method="post" action={`/projects/${projectId}${next.secondary.action}`} use:enhance={run(next.secondary.action)}>
      <button class="btn btn-ghost {cls}" type="submit" disabled={busy !== null} aria-busy={busy === next.secondary.action}>
        {busy === next.secondary.action ? PROGRESS[next.secondary.action].button : next.secondary.label}
      </button>
    </form>
  {:else if next.secondary?.href && !secondaryHere}
    <a class="btn btn-ghost {cls}" href={next.secondary.href}>{next.secondary.label}</a>
  {/if}
{/snippet}

{#snippet primaryAction(cls: string, quiet: boolean)}
  {#if next.action}
    <form method="post" action={`/projects/${projectId}${next.action}`} use:enhance={run(next.action)}>
      <button class="btn {quiet ? 'btn-outline border-line-control' : 'btn-primary'} {cls}" type="submit" disabled={busy !== null} aria-busy={busy === next.action}>
        {#if busy === next.action}{PROGRESS[next.action].button}{:else}{next.cta}<ArrowRight class="size-4" aria-hidden="true" />{/if}
      </button>
    </form>
  {:else if next.href && !here}
    <a class="{finished || quiet ? 'btn btn-outline border-line-control' : 'btn btn-primary'} {cls}" href={next.href}>
      {next.cta}{#if !finished}<ArrowRight class="size-4" aria-hidden="true" />{/if}
    </a>
  {/if}
{/snippet}

{#snippet actions(size: string = "", withSecondary = true, withPrimary = true, quiet = false)}
  <div class="flex max-w-full shrink-0 flex-wrap items-center gap-2">
    {#if withSecondary}{@render secondaryAction(size)}{/if}
    {#if withPrimary}{@render primaryAction(size, quiet)}{/if}
  </div>
{/snippet}

{#snippet feedback()}
  {#if busy}
    <AiProgress class="mt-2" active={busy !== null} label={PROGRESS[busy].label} estimate={PROGRESS[busy].estimate} />
  {/if}
  {#if error}
    <p class="mt-2 text-[13px] text-danger" role="alert">{error}</p>
  {/if}
  {#if genRun.done && !busy}
    {@const done = genRun.done}
    <p class="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-base-content" role="status">
      <CircleCheck class="size-4 shrink-0 text-mint" aria-hidden="true" />
      <span>{DONE[done.action]}</span>
      <a
        class="font-medium underline underline-offset-2"
        href={`/projects/${projectId}/${AFTER[done.action]}`}
        onclick={() => setRun(projectId, { done: null })}>Open it</a
      >
    </p>
  {/if}
{/snippet}

{#snippet detail(withPrimary = true)}
  <p class="text-xs text-base-content/80">{stepText}{#if here && !finished}{" · you're here"}{/if}</p>
  <p class="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold text-base-content">
    {#if finished}<CircleCheck class="size-4 shrink-0 text-mint" aria-hidden="true" />{/if}{next.title}
  </p>
  <p class="mt-1 text-[13px] leading-relaxed text-base-content/80">{next.detail}</p>
  {#if withPrimary || next.secondary}<div class="mt-3">{@render actions("btn-sm", true, withPrimary)}</div>{/if}
  {@render feedback()}
{/snippet}

{#if variant === "panel"}
  <section aria-labelledby="journey-next-title">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0 max-w-[62ch]">
        <p class="text-xs font-medium text-base-content/80">{stepText}{#if note}{` · ${note}`}{/if}</p>
        <svelte:element this={`h${level}`} id="journey-next-title" class="mt-0.5 flex items-center gap-1.5 text-[16px] font-semibold text-base-content">
          {#if finished}<CircleCheck class="size-4 shrink-0 text-mint" aria-hidden="true" />{/if}{next.title}
        </svelte:element>
        <p class="mt-1 text-[13px] leading-relaxed text-base-content/80">{next.detail}</p>
      </div>
      {@render actions()}
    </div>
    {@render feedback()}
  </section>
{:else if variant === "inline"}
  <aside class="flex min-w-0 shrink-0 items-center gap-2 max-sm:hidden" aria-label="Next step">
    <Dropdown bind:open={popoverOpen} align="end" class="max-h-[min(36rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-box border border-line bg-base-100 p-4 shadow-xl">
      {#snippet trigger(props)}
        <button type="button" {...props} class="btn btn-ghost btn-sm min-w-0 flex-nowrap gap-2 px-2 font-normal" aria-label={`Next step: ${next.title}`}>
          <span class="shrink-0 text-xs font-semibold text-primary-ink">{finished ? "Done" : "Next:"}</span>
          {#if busy}<span class="loading loading-spinner loading-xs text-base-content/80" aria-hidden="true"></span>{/if}
          {#if error}<span class="size-2 shrink-0 rounded-full bg-danger" aria-hidden="true"></span>{/if}
          <!-- The row has no room for the sentence next to nine chapters; the button names the action and the popover the rest. -->
          <span class="sr-only">{next.title}</span>
          <ChevronDown class="size-3.5 shrink-0 text-base-content/80" aria-hidden="true" />
        </button>
      {/snippet}
      {@render detail()}
    </Dropdown>
    <!-- Quiet: the page below owns the one green button; the bar only points the way — unless the page has none. -->
    <!-- On the page the step's skip leads to (the screens after skipping the design system),
         the bar does not send the user back: the popover still explains the step. -->
    {@render actions("btn-sm", false, !secondaryHere, !prominent)}
  </aside>

  <!-- Phones: the next step as a bottom action bar; its detail opens as a bottom sheet. -->
  <aside
    class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base-100 pt-2.5 pr-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] pl-4 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] sm:hidden"
    aria-label="Next step"
  >
    <div class="flex items-center gap-2.5">
      <button
        type="button"
        class="btn btn-ghost h-auto min-h-11 min-w-0 flex-1 flex-col flex-nowrap items-start justify-center gap-0 px-1 text-left font-normal"
        aria-label={`Next step: ${next.title}`}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onclick={() => (sheetOpen = true)}
      >
        <span class="flex items-center gap-1.5 text-xs text-base-content/80">
          {finished ? "Done" : "Next"}
          {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          {#if error}<span class="size-2 rounded-full bg-danger" aria-hidden="true"></span>{/if}
          <ChevronDown class="size-3 rotate-180" aria-hidden="true" />
        </span>
        <span class="w-full truncate text-[14px] font-semibold text-base-content">{next.title}</span>
      </button>
      <!-- Quiet: the page owns the one green button; the sheet carries the full-width one. -->
      {@render actions("h-11", false, !secondaryHere, true)}
    </div>
  </aside>

  <Modal bind:open={sheetOpen} sheetOnPhone labelledby="next-sheet-title" describedby="next-sheet-desc" boxClass="flex flex-col gap-3 p-4">
    <div class="flex items-start justify-between gap-2">
      <div class="flex min-w-0 flex-col gap-1.5 pt-1">
        <p class="text-xs font-medium text-base-content/80">{stepText}{#if here && !finished}{" · you're here"}{/if}</p>
        <h2 id="next-sheet-title" class="flex items-center gap-2 text-[22px] leading-tight font-bold tracking-tight text-base-content">
          {#if finished}<CircleCheck class="size-5 shrink-0 text-mint" aria-hidden="true" />{/if}{next.title}
        </h2>
        <p id="next-sheet-desc" class="text-[14px] leading-relaxed text-base-content/80">{next.detail}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-square -mr-2 size-11 shrink-0" aria-label="Close" onclick={() => (sheetOpen = false)}>
        <X class="size-5" aria-hidden="true" />
      </button>
    </div>
    {@render feedback()}
    <div class="flex flex-col gap-2 pt-1.5 empty:hidden [&_form]:w-full">
      {@render primaryAction("h-12 w-full text-base", false)}
      {@render secondaryAction("h-11 w-full")}
    </div>
  </Modal>
{:else}
  <aside class="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-box border border-line bg-base-100 px-4 py-3" aria-label="Next step">
    <div class="min-w-0 flex-1">
      <p class="text-xs text-base-content/80">{stepText}{#if here && !finished}{" · you're here"}{/if}</p>
      <p class="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold text-base-content">
        {#if finished}<CircleCheck class="size-4 shrink-0 text-mint" aria-hidden="true" />{/if}
        <span class="min-w-0">{next.title}</span>
      </p>
      <!-- One line on phones, the full sentence from md up: the why is never dropped. -->
      <p class="mt-0.5 max-w-[80ch] truncate text-[13px] text-base-content/80 md:whitespace-normal">{next.detail}</p>
      {@render feedback()}
    </div>
    {@render actions()}
  </aside>
{/if}

