<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { Check, ChevronDown, Lock, TriangleAlert } from "lucide-svelte";
  import type { Journey, MilestoneId } from "$lib/journey.js";

  /**
   * The receipt before a decision that other work builds on (approve a spec,
   * lock the stack). The button opens it; it says what is being approved and
   * what it replaces, what that unlocks, which existing work goes STALE (the
   * API's downstream order, docs/12 §10 — only chapters that already have
   * something), and how to change course later. Confirming submits the form.
   */
  type Kind = "requirements" | "stack" | "design" | "design_system" | "ux";
  let {
    kind,
    version,
    replaces = null,
    summary = "",
    action,
    fields,
    label,
    small = false,
    disabled = false,
    title,
    onDone,
  }: {
    kind: Kind;
    /** The version this decision makes the baseline. */
    version: number;
    /** The version in use now, if any. */
    replaces?: number | null;
    /** One line on what the new version holds ("17 requirements, 8 P0"). */
    summary?: string;
    action: string;
    fields: Record<string, string>;
    label: string;
    small?: boolean;
    disabled?: boolean;
    /** Why the button is disabled, when it is. */
    title?: string;
    /** Called after the form result lands (true on success). */
    onDone?: (ok: boolean) => void;
  } = $props();

  const NAME: Record<Kind, string> = {
    requirements: "requirements",
    stack: "stack",
    design: "technical design",
    design_system: "design system",
    ux: "UI reference",
  };
  const VERB: Record<Kind, string> = { requirements: "Approve", stack: "Lock", design: "Approve", design_system: "Use", ux: "Approve" };
  // Mirrors DOWNSTREAM in apps/api artifact/service.ts, as notebook chapters.
  const DOWNSTREAM: Record<Kind, MilestoneId[]> = {
    requirements: ["stack", "design", "tasks", "screens"],
    stack: ["design", "system", "tasks", "screens"],
    design: ["tasks", "screens"],
    design_system: ["screens"],
    ux: [],
  };
  const UNLOCKS: Record<Kind, string> = {
    requirements: "Choosing the stack, then the technical design written against both.",
    stack: "The technical design and the design system are written against this stack.",
    design: "Tasks can be generated from it, and the UI reference can be drawn.",
    design_system: "The UI reference can be drawn in this look.",
    ux: "Its screens go into task work orders as the visual reference.",
  };

  const journey = $derived((page.data as { journey?: Journey }).journey);
  // Only chapters that already hold something can go stale, and only when a
  // different version was in use (a first approval has nothing built on it).
  const goesStale = $derived(
    replaces === null || !journey
      ? []
      : DOWNSTREAM[kind]
          .map((id) => journey.milestones.find((m) => m.id === id))
          .filter((m) => m && (m.state === "done" || m.state === "draft"))
          .map((m) => ({
            label: m!.label,
            detail: kind === "design_system" && m!.id === "screens" ? "Screens drawn in the old look" : m!.summary,
          })),
  );

  let open = $state(false);
  let busy = $state(false);
  // Why the last attempt failed, shown in the receipt: it stays open so the decision keeps its context.
  let failure = $state<string | null>(null);
  const Icon = $derived(kind === "stack" ? Lock : Check);
</script>

<button type="button" class="btn btn-primary {small ? 'btn-sm text-xs' : ''}" onclick={() => { failure = null; open = true; }} disabled={busy || disabled} {title}>
  {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Icon class="size-3.5" aria-hidden="true" />{/if}
  <span>{label}</span>
</button>

<Modal
  bind:open
  dismissible={!busy}
  labelledby="receipt-title"
  describedby="receipt-desc"
  sheetOnPhone
  boxClass="flex max-h-[calc(100dvh-2rem)] max-w-[480px] flex-col gap-6 overflow-y-auto rounded-box border border-line p-6 max-sm:gap-5 sm:p-8"
>
  <div class="flex flex-col gap-2">
    <h2 id="receipt-title" class="text-[24px] leading-tight font-extrabold tracking-tight text-base-content sm:text-[26px]">
      {VERB[kind]} {NAME[kind]} v{version}?
    </h2>
    <p id="receipt-desc" class="text-[13px] leading-relaxed text-base-content/80">
      {#if replaces !== null && replaces !== version}Replaces v{replaces}. {/if}This can't be undone. Later changes need a new version.
    </p>
  </div>

  {#if goesStale.length}
    <div class="flex flex-col gap-2.5 rounded-box border border-warn/40 bg-warn-soft px-4 py-3.5 text-[13px]">
      <p class="flex items-center gap-2.5 font-semibold text-base-content">
        <TriangleAlert class="size-4 shrink-0 text-warn" aria-hidden="true" />These will need a fresh look
      </p>
      <ul class="ms-[26px] flex flex-col gap-1.5 text-base-content">
        {#each goesStale as item (item.label)}<li>{item.label}{#if item.detail}<span class="text-base-content/80"> · {item.detail}</span>{/if}</li>{/each}
      </ul>
    </div>
  {/if}

  <!-- What the new baseline holds and opens up: there when wanted, folded otherwise. -->
  <details class="group -mt-2 text-[13px]">
    <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
      <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
      What it unlocks
    </summary>
    <p class="mt-1 ps-5 leading-relaxed text-base-content/80">
      {#if summary}<span class="text-base-content">{summary}.</span> {/if}{UNLOCKS[kind]}
    </p>
  </details>

  {#if failure}<Notice tone="error">{failure}</Notice>{/if}

  <form
    method="post"
    {action}
    class="flex flex-wrap items-center justify-end gap-2 max-sm:flex-col-reverse max-sm:flex-nowrap max-sm:items-stretch"
    use:enhance={() => {
      // Open until the server answers: closing first lost the receipt when the decision failed.
      busy = true;
      failure = null;
      return async ({ result, update }) => {
        busy = false;
        const ok = result.type === "success" || result.type === "redirect";
        if (ok) open = false;
        else if (result.type === "failure") failure = (result.data as { message?: string } | undefined)?.message ?? "It could not be saved. Try again.";
        else if (result.type === "error") failure = result.error?.message ?? "It could not be saved. Try again.";
        await update();
        onDone?.(ok);
      };
    }}
  >
    {#each Object.entries(fields) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
    <!-- Phones: the decision full width in thumb reach, Cancel under it (the column is reversed, so the order stays Cancel → confirm). -->
    <button type="button" onclick={() => (open = false)} class="btn btn-ghost max-sm:h-11" disabled={busy}>Cancel</button>
    <button class="btn btn-primary max-sm:h-12 max-sm:text-base" type="submit" disabled={busy} aria-busy={busy}>
      {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Icon class="size-4" aria-hidden="true" />{/if}{VERB[kind]} v{version}
    </button>
  </form>
</Modal>
