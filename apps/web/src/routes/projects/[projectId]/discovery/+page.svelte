<script lang="ts">
  import { fade } from "svelte/transition";
  import { tick } from "svelte";
  import { enhance } from "$app/forms";
  import { ArrowRight, Check, ChevronDown, CircleAlert, CircleCheck, Pencil, Send, Sparkles, Wand2 } from "lucide-svelte";
  import AiProgress from "$lib/components/AiProgress.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { coverageTopicLabel } from "$lib/labels.js";

  /**
   * Discovery as an interview: one question at a time on the left, and on the
   * right the brief it is writing — every answer, editable, plus what the
   * engine inferred and assumed. One readiness rule, shown as one meter:
   * ready at DISCOVERY_READY_AFTER_ANSWERS answers, or sooner once the core
   * topics are covered (the API decides; the meter never moves backwards).
   */

  /** Mirrors DISCOVERY_READY_AFTER_ANSWERS in @sdd/contracts. */
  const READY_AFTER = 15;

  interface BatchQuestion {
    id: string;
    text: string;
    reason: string;
    topic: string;
    options: string[];
    blocking: boolean;
  }

  interface DiscoveryData {
    session: {
      id: string;
      status: string;
      readiness: string;
      coverage: Record<string, { status: string; blocking: boolean }>;
      understanding: string;
    } | null;
    answered: Array<{ question: { id: string; questionText: string; topic: string }; answer: { answer: { text: string } } | null }>;
    pending: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
    facts: Array<{ id: string; factKey: string; value: string; sourceType: string }>;
    assumptions: Array<{ id: string; description: string; status: string }>;
    readiness: string;
  }

  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; key: string; name: string };
      discovery: DiscoveryData | null;
      /** Session completed, or the project is past discovery: show the read-only brief. */
      finished: boolean;
      /** Discovery is under way, so the page may ask for a batch on its own. */
      mayAutoRequest: boolean;
    };
    form:
      | {
          submitted?: number;
          last?: { qid: string; text: string };
          revised?: string;
          batch?: BatchQuestion[];
          readiness?: string;
          complete?: boolean;
          source?: string;
          deepened?: boolean;
          accepted?: boolean;
          started?: boolean;
          notice?: string;
          message?: string;
        }
      | null;
  } = $props();

  const d = $derived(data.discovery);
  const answeredEntries = $derived(d ? d.answered.filter((a) => a.answer) : []);
  const answeredCount = $derived(answeredEntries.length);
  const inferredFacts = $derived(d ? d.facts.filter((f) => f.sourceType !== "USER_STATED") : []);
  // A finished brief sets these beside the answers (desktop) rather than below them.
  const hasNotes = $derived(Boolean(d && (d.assumptions.length > 0 || d.pending.length > 0 || inferredFacts.length > 0)));
  const openAssumptions = $derived(d ? d.assumptions.filter((a) => a.status === "PROPOSED") : []);

  // The engine pre-generates a batch; the page shows exactly one question at a
  // time (docs/14 §5). The server returns the pending remainder after each
  // answer, so batch[0] is always the question to show now.
  const batch = $derived<BatchQuestion[]>(
    form?.batch ??
      (d?.pending ?? []).map((q) => ({
        id: q.id,
        text: q.questionText,
        reason: q.reason,
        topic: q.topic,
        options: q.options ?? [],
        blocking: q.blocking,
      })),
  );
  const current = $derived<BatchQuestion | null>(batch[0] ?? null);
  // The AI's usual choice for this question: its first suggested option.
  const recommendedDefault = $derived(current?.options[0] ?? "");

  let currentAnswer = $state("");
  // Reset the field only when the question actually changes, so a failed
  // submit keeps what was typed.
  let lastQuestionId: string | undefined;
  $effect(() => {
    const id = current?.id;
    if (id !== lastQuestionId) {
      lastQuestionId = id;
      currentAnswer = "";
    }
  });
  const canSubmit = $derived(currentAnswer.trim().length > 0);

  // One readiness rule, straight from the API.
  const readiness = $derived(form?.readiness ?? d?.readiness ?? d?.session?.readiness ?? "INCOMPLETE");
  const ready = $derived(form?.complete === true || readiness === "READY" || readiness === "READY_WITH_ASSUMPTIONS");
  // Monotonic: answers only accumulate, and once ready it stays full.
  const meter = $derived(ready ? READY_AFTER : Math.min(answeredCount, READY_AFTER - 1));

  let submitting = $state(false);
  let deepening = $state(false);
  // The load is read-only (link preloading must never start an AI call), so
  // the page asks for the next batch itself — once, and only while the server
  // says discovery is under way (`mayAutoRequest`).
  let autoNextForm = $state<HTMLFormElement | null>(null);
  let autoRequested = $state(false);
  let generating = $state(false);
  const needsBatch = $derived(
    data.mayAutoRequest &&
      !data.finished &&
      (form === null || form.started === true) &&
      batch.length === 0 &&
      !!d?.session &&
      d.session.status !== "COMPLETED" &&
      !ready,
  );
  $effect(() => {
    if (needsBatch && !autoRequested && autoNextForm) {
      autoRequested = true;
      autoNextForm.requestSubmit();
    }
  });

  // Working-state hint. The engine runs a deterministic question bank when no
  // AI provider is bound, so these describe what it does on both paths. Visual
  // only: the AiProgress line is the one announcement.
  const STAGES = [
    "Reviewing what you have answered…",
    "Checking for contradictions and open assumptions…",
    "Choosing the questions that change the most…",
  ];
  let stageIndex = $state(0);
  $effect(() => {
    if (!generating && !submitting && !deepening) return;
    stageIndex = 0;
    const timer = setInterval(() => (stageIndex = (stageIndex + 1) % STAGES.length), 2600);
    return () => clearInterval(timer);
  });
  const busy = $derived(generating || submitting || deepening);
  const progressLabel = $derived(
    deepening ? "Preparing 5 more questions" : submitting ? "Saving your answer and choosing the next question" : "Choosing your next questions",
  );

  // Editing an answer in the brief.
  let editing = $state<string | null>(null);
  let editText = $state("");
  let saving = $state(false);
  // Phones: the brief folds into one row below the question card.
  let briefOpen = $state(false);
  async function startEdit(qid: string) {
    const entry = answeredEntries.find((e) => e.question.id === qid);
    if (!entry) return;
    editing = qid;
    briefOpen = true;
    editText = entry.answer?.answer.text ?? "";
    await tick();
    const field = document.getElementById(`edit-${qid}`) as HTMLTextAreaElement | null;
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.focus();
  }
  const lastQuestion = $derived(form?.last ? answeredEntries.find((e) => e.question.id === form.last!.qid) : undefined);

  // Answers left before the count gate (the API may call it ready sooner).
  const toGo = $derived(Math.max(READY_AFTER - answeredCount, 0));
  // The brief, grouped by topic in the order topics were first answered.
  const briefGroups = $derived.by(() => {
    const groups: Array<{ topic: string; entries: typeof answeredEntries }> = [];
    for (const entry of answeredEntries) {
      const label = coverageTopicLabel(entry.question.topic);
      const group = groups.find((g) => g.topic === label);
      if (group) group.entries.push(entry);
      else groups.push({ topic: label, entries: [entry] });
    }
    return groups;
  });
</script>

<!-- What discovery assumed or inferred, and (once finished) what it left open. -->
{#snippet notes(openQuestions: boolean)}
    {#if openQuestions && d && d.pending.length > 0}
      <div class="flex flex-col gap-2">
        <h3 class="text-[13px] font-semibold text-base-content">Open questions <span class="font-mono font-normal text-base-content/75">{d.pending.length}</span></h3>
        <ul class="flex flex-col gap-2 text-[13px] text-base-content">
          {#each d.pending as q (q.id)}
            <li class="flex items-start gap-2">
              <CircleAlert class="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
              <span class="leading-snug">{q.questionText}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if d && d.assumptions.length > 0}
      <div class="flex flex-col gap-2 border-t border-line pt-3">
        <h3 class="text-[13px] font-semibold text-base-content">Assumptions</h3>
        <ul class="flex flex-col gap-2 text-[13px] text-base-content/80">
          {#each d.assumptions as assumption (assumption.id)}
            <li class="flex items-start gap-2">
              {#if assumption.status === "ACCEPTED"}
                <CircleCheck class="mt-0.5 size-3.5 shrink-0 text-mint" aria-hidden="true" /><span class="sr-only">Accepted:</span>
              {:else}
                <CircleAlert class="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" /><span class="sr-only">Not yet accepted:</span>
              {/if}
              <span class="leading-snug">{assumption.description}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if inferredFacts.length > 0}
      <details class="collapse collapse-arrow rounded-none border-t border-line pt-3">
        <summary class="collapse-title min-h-0 px-0 py-1 pe-6 after:end-1 text-[13px] font-semibold text-base-content">
          Inferred facts <span class="font-normal text-base-content/80">· {inferredFacts.length}</span>
        </summary>
        <div class="collapse-content px-0 pb-0">
          <ul class="mt-2 flex flex-col gap-1.5 text-[13px] text-base-content/80">
            {#each inferredFacts as fact (fact.id)}
              <li class="leading-snug break-words">{fact.value}</li>
            {/each}
          </ul>
        </div>
      </details>
    {/if}

{/snippet}

{#snippet brief(editable: boolean, foldable = false, withNotes = true, wide = false)}
  <!-- The brief discovery is writing: the answers first, in the user's words -->
  <section
    id="discovery-brief"
    class="card flex flex-col gap-4 border border-line bg-base-100 p-5 sm:px-6 {foldable ? 'max-sm:rounded-t-none max-sm:border-t-0 max-sm:pt-1' : ''} {foldable && !briefOpen ? 'max-sm:hidden' : ''}"
    aria-labelledby="brief-title"
  >
    <h2 id="brief-title" class="border-b border-line pb-3 text-[16px] font-semibold text-base-content {foldable ? 'max-sm:sr-only' : ''}">Brief</h2>
    {#if d?.session?.understanding}
      <p class="text-[13px] leading-relaxed text-base-content/80">{d.session.understanding}</p>
    {/if}
    {#if answeredEntries.length === 0}
      <p class="text-[13px] text-base-content/80">Your answers collect here.</p>
    {:else}
      <div class="flex flex-col gap-4 {wide ? 'lg:block lg:columns-2 lg:gap-10' : ''}">
      {#each briefGroups as group (group.topic)}
        <div class="flex flex-col gap-2 {wide ? 'lg:mb-5 lg:break-inside-avoid' : ''}">
          {#if editable}
            <p class="text-xs font-medium text-base-content/80">{group.topic}</p>
          {:else}
            <h3 class="text-[13px] font-semibold text-base-content">{group.topic}</h3>
          {/if}
          <ol class="flex flex-col {editable ? 'gap-2.5' : 'gap-3.5'}">
            {#each group.entries as entry (entry.question.id)}
              <li>
                {#if editing === entry.question.id}
                  <form
                    method="post"
                    action="?/revise"
                    class="flex flex-col gap-1.5"
                    use:enhance={() => {
                      saving = true;
                      return async ({ result, update }) => {
                        saving = false;
                        if (result.type === "success") editing = null;
                        await update({ reset: false });
                      };
                    }}
                  >
                    <input type="hidden" name="qid" value={entry.question.id} />
                    <label class="text-xs text-base-content/75" for={`edit-${entry.question.id}`}>{entry.question.questionText}</label>
                    <textarea
                      id={`edit-${entry.question.id}`}
                      name="answer"
                      rows="3"
                      class="textarea w-full rounded-box text-[13px] leading-relaxed"
                      bind:value={editText}
                      onkeydown={(e) => {
                        if (e.key === "Escape") editing = null;
                      }}
                    ></textarea>
                    <div class="flex gap-1.5">
                      <button class="btn btn-sm btn-outline" type="submit" disabled={saving || !editText.trim()}>
                        {#if saving}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}Save answer
                      </button>
                      <button class="btn btn-sm btn-ghost" type="button" onclick={() => (editing = null)}>Cancel</button>
                    </div>
                  </form>
                {:else}
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                    <div class="min-w-0">
                      <!-- Read-only, the recorded answer is the text; the question only labels it. -->
                      <p class="text-xs text-base-content/75">{entry.question.questionText}</p>
                      <p class="{editable ? 'text-[13px]' : 'mt-0.5 text-[14px]'} leading-relaxed break-words text-base-content">{entry.answer?.answer.text}</p>
                    </div>
                    {#if editable}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm btn-square text-base-content/80"
                        onclick={() => startEdit(entry.question.id)}
                        aria-label={`Change your answer to: ${entry.question.questionText}`}
                      >
                        <Pencil class="size-3.5" aria-hidden="true" />
                      </button>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
        </div>
      {/each}
      </div>
    {/if}

    {#if withNotes}{@render notes(false)}{/if}
  </section>
{/snippet}

<main class="w-full pb-10">
  {#if data.finished}
    <!-- Discovery is behind this project: the brief, read-only. Nothing here asks the engine for anything. -->
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-[28px] font-extrabold tracking-tight sm:text-[32px]">Discovery <span class="text-primary-ink">complete</span></h1>
        <p class="text-[13px] text-base-content/80">Read-only. Change it in a new requirements version.</p>
      </div>
      <a class="btn btn-primary" href={`/projects/${data.project.id}/docs?tab=requirements`}>
        Open requirements<ArrowRight class="size-4" aria-hidden="true" />
      </a>
    </header>
    {#if form?.message}
      <Notice tone="error" class="mb-5 max-w-[760px]">{form.message}</Notice>
    {:else if form?.notice}
      <Notice tone="success" class="mb-5 max-w-[760px]">{form.notice}</Notice>
    {/if}
    {#if hasNotes}
      <!-- Desktop: the answers, and beside them what discovery assumed, inferred or left open. -->
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
        {@render brief(false, false, false)}
        <aside class="card flex flex-col gap-4 border border-line bg-base-100 p-5 sm:px-6 lg:sticky lg:top-[70px]" aria-labelledby="notes-title">
          <h2 id="notes-title" class="border-b border-line pb-3 text-[16px] font-semibold text-base-content">Assumptions and open questions</h2>
          <div class="flex flex-col gap-4 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">{@render notes(true)}</div>
        </aside>
      </div>
    {:else}
      <!-- Nothing assumed or left open: the answers take the width, topics in two columns. -->
      {@render brief(false, false, false, true)}
    {/if}
  {:else}
    <div class="grid gap-6 max-sm:grid-cols-1 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-12">
      <!-- Phones: the interview's parts join the page column so the folded brief sits right under the question card. -->
      <section class="flex min-w-0 flex-col gap-6 max-sm:contents sm:gap-7" aria-label="Interview">
        {#if data.mayAutoRequest}
          <!-- Only rendered while discovery is under way (see `needsBatch`). -->
          <form
            bind:this={autoNextForm}
            method="post"
            action="?/next"
            hidden
            use:enhance={() => {
              generating = true;
              return async ({ update }) => {
                generating = false;
                await update();
              };
            }}
          ></form>
        {/if}

        <header>
          <h1 class="text-[28px] font-extrabold tracking-tight sm:text-[32px]">
            {#if !d?.session}Start discovery
            {:else if ready}Discovery is <span class="text-primary-ink">ready</span>
            {:else}Discovery: {toGo} {toGo === 1 ? "answer" : "answers"} to go{/if}
          </h1>
        </header>

        {#if form?.message}
          <Notice tone="error">{form.message}</Notice>
        {:else if form?.notice}
          <Notice tone="success">{form.notice}</Notice>
        {/if}

        {#if d?.session}
          <!-- The one readiness meter: answers toward the gate, never backwards -->
          <div class="flex items-center gap-2">
            <div
              class="grid flex-1 grid-cols-[repeat(15,minmax(0,1fr))] gap-[3px]"
              role="progressbar"
              aria-label="Discovery readiness"
              aria-valuemin={0}
              aria-valuemax={READY_AFTER}
              aria-valuenow={meter}
              aria-valuetext={ready ? "Ready" : `${answeredCount} answers recorded; material decisions remain open`}
            >
              {#each Array.from({ length: READY_AFTER }, (_, i) => i) as i (i)}
                <span
                  class="block h-2 rounded-full {i < meter ? (ready ? 'bg-mint' : 'bg-primary') : 'bg-base-300'} {!ready && i === meter
                    ? 'ring-1 ring-primary-ink ring-inset'
                    : ''}"
                ></span>
              {/each}
            </div>
            <span
              class="grid size-4 shrink-0 place-items-center rounded-full {ready ? 'bg-mint text-base-100' : 'border-2 border-line-control'}"
              title={ready ? "Ready" : "Ready when material decisions are resolved or explicitly documented as accepted assumptions"}
              aria-hidden="true"
            >
              {#if ready}<Check class="size-3" strokeWidth={3} />{/if}
            </span>
          </div>
        {/if}

        {#if form?.last && lastQuestion && !busy}
          <!-- One tap answers, so one tap changes it too -->
          <div class="flex items-center gap-3 rounded-field border border-line bg-base-100 py-1 ps-4 pe-1 text-[13px]" role="status">
            <CircleCheck class="size-3.5 shrink-0 text-mint" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-base-content/80">Recorded: <span class="text-base-content">{form.last.text}</span></span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => startEdit(form!.last!.qid)}>Change</button>
          </div>
        {/if}

        {#if !d?.session}
          <div class="card flex flex-col items-start gap-4 border border-line bg-base-100 p-6">
            <p class="text-[14px] text-base-content/80">A few short questions about {data.project.name}.</p>
            <form method="post" action="?/start" use:enhance>
              <button class="btn btn-primary" type="submit">
                <Sparkles class="size-4" aria-hidden="true" />Start discovery
              </button>
            </form>
          </div>
        {:else if ready && batch.length === 0}
          <div class="card flex flex-col gap-4 border border-mint/40 bg-base-100 p-6 sm:px-7" transition:fade={{ duration: 150 }}>
            <div class="flex flex-col gap-1.5">
              <h2 class="flex items-center gap-2 text-[20px] font-bold tracking-tight">
                <CircleCheck class="size-5 text-mint" aria-hidden="true" />Ready for requirements
              </h2>
              <p class="max-w-[60ch] text-[13px] text-base-content/80">
                {readiness === "READY" ? "The core topics are covered." : "Open topics are listed as assumptions."}
              </p>
            </div>
            {#if openAssumptions.length && readiness === "READY_WITH_ASSUMPTIONS"}
              <ul class="flex flex-col gap-2">
                {#each openAssumptions as assumption (assumption.id)}
                  <li class="flex items-start gap-2 rounded-box border border-warn/40 bg-warn-soft px-3.5 py-2 text-[13px]">
                    <CircleAlert class="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
                    <span>{assumption.description}</span>
                  </li>
                {/each}
              </ul>
              <form method="post" action="?/acceptAssumptions" use:enhance>
                <input type="hidden" name="sessionId" value={d?.session?.id ?? ""} />
                <button class="btn btn-outline btn-sm" type="submit" disabled={deepening}>
                  <CircleCheck class="size-3.5" aria-hidden="true" />Accept assumptions
                </button>
              </form>
            {/if}
            <div class="flex flex-wrap gap-2 border-t border-line pt-4">
              <form method="post" action="?/complete" use:enhance>
                {#if readiness === "INCOMPLETE"}
                  <!-- The question bank ran out with required topics open: finishing is an explicit choice to rely on assumptions (C7). -->
                  <input type="hidden" name="accept_assumptions" value="1" />
                {/if}
                <button class="btn btn-primary" type="submit" disabled={deepening}>
                  Finish discovery<ArrowRight class="size-4" aria-hidden="true" />
                </button>
              </form>
              <form
                method="post"
                action="?/deepen"
                use:enhance={() => {
                  deepening = true;
                  return async ({ update }) => {
                    deepening = false;
                    await update();
                  };
                }}
              >
                <button class="btn btn-outline" type="submit" disabled={deepening} aria-busy={deepening}>
                  {#if deepening}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Wand2 class="size-4" aria-hidden="true" />{/if}
                  {deepening ? "Preparing questions…" : "Ask 5 more"}
                </button>
              </form>
            </div>
            <AiProgress active={deepening} label={progressLabel} estimate="about a minute" />
          </div>
        {:else if busy}
          <div class="card flex flex-col gap-3 border border-line bg-base-100 p-6 sm:px-7" transition:fade={{ duration: 120 }} aria-busy="true">
            <h2 class="text-[16px] font-semibold">{submitting ? "Saving your answer…" : "Choosing your next questions…"}</h2>
            <progress class="progress progress-primary h-1 w-full" aria-hidden="true"></progress>
            <p class="text-xs text-base-content/80" aria-hidden="true">{STAGES[stageIndex]}</p>
            <AiProgress active={busy} label={progressLabel} estimate="about a minute" />
          </div>
        {:else if current}
          <!-- ONE question per screen (docs/14 §5, docs/04 §4.1) -->
          <form
            method="post"
            action="?/answerBatch"
            aria-labelledby={`q-${current.id}`}
            use:enhance={() => {
              submitting = true;
              return async ({ result, update }) => {
                submitting = false;
                if (result.type === "success") currentAnswer = "";
                await update({ reset: result.type === "success" });
              };
            }}
            class="card flex flex-col gap-4 border border-primary-ink bg-base-100 p-5 sm:px-7 sm:py-6"
          >
            <div class="flex flex-col gap-1.5">
              <p class="flex flex-wrap items-center gap-2 text-xs text-base-content/80">
                <span>{coverageTopicLabel(current.topic)}</span>
                {#if current.blocking}
                  <span class="badge badge-sm gap-1 border-warn/40 bg-warn-soft font-semibold text-warn" title="Needed before requirements">
                    <CircleAlert class="size-3" aria-hidden="true" />Required
                  </span>
                {/if}

              </p>
              <h2 id={`q-${current.id}`} class="text-[20px] leading-snug font-bold tracking-tight text-balance sm:text-[22px]">{current.text}</h2>
              {#if current.reason}
                <p class="max-w-[72ch] text-[13px] text-base-content/80">{current.reason}</p>
              {/if}
            </div>
            <input type="hidden" name="qid" value={current.id} />

            {#if current.options.length}
              <fieldset>
                <legend class="sr-only">Pick an answer</legend>
                <div class="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
                  {#each current.options as option}
                    <button
                      type="submit"
                      name="choice"
                      value={option}
                      disabled={submitting}
                      class="btn btn-outline h-auto min-h-11 max-w-full justify-start py-2 text-left text-[14px] font-medium whitespace-normal max-sm:justify-center max-sm:px-3 max-sm:text-center"
                    >
                      {option}
                    </button>
                  {/each}
                </div>
              </fieldset>
            {/if}

            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-base-content/75" for={`a-${current.id}`}>
                {current.options.length ? "Your own words" : "Your answer"}
              </label>
              <textarea
                id={`a-${current.id}`}
                class="textarea min-h-[76px] w-full resize-y rounded-box text-[14px] leading-relaxed"
                name="answer"
                rows="3"
                aria-describedby={`q-${current.id}`}
                placeholder="Short is fine."
                bind:value={currentAnswer}
                onkeydown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
                  }
                }}
              ></textarea>
            </div>

            <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:border-t sm:border-line sm:pt-4">
              <!-- Not knowing is an answer too: the button names what gets recorded -->
              <div class="flex min-w-0 flex-wrap gap-1.5 max-sm:-mt-1 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2" role="group" aria-label="Not sure?">
                {#if recommendedDefault}
                  <button
                    class="btn btn-sm btn-outline max-w-full max-sm:h-11 max-sm:text-[13px]"
                    type="submit"
                    formaction="?/defer"
                    name="recommendation"
                    value={recommendedDefault}
                    disabled={submitting}
                    title="Record the usual choice as an assumption to revisit"
                  >
                    <Wand2 class="size-3.5 shrink-0" aria-hidden="true" /><span class="truncate">Assume “{recommendedDefault}”</span>
                  </button>
                {/if}
                <button
                  class="btn btn-sm btn-ghost max-sm:h-11 max-sm:text-[13px] {recommendedDefault ? '' : 'max-sm:col-span-2'}"
                  type="submit"
                  formaction="?/defer"
                  name="recommendation"
                  value=""
                  disabled={submitting}
                  title="Recorded as an open assumption to accept before the requirements"
                >
                  Skip for now
                </button>
              </div>
              <div class="flex w-full items-center gap-3 sm:w-auto">
                <!-- A keyboard hint only where there is a keyboard. -->
                <span class="hidden text-xs whitespace-nowrap text-base-content/75 [@media(pointer:fine)_and_(min-width:40rem)]:inline"><kbd class="kbd kbd-xs">Ctrl</kbd> + <kbd class="kbd kbd-xs">Enter</kbd></span>
                <button class="btn btn-primary w-full max-sm:btn-lg sm:w-auto" type="submit" disabled={submitting || !canSubmit} aria-busy={submitting}>
                  <Send class="size-4" aria-hidden="true" />Send answer
                </button>
              </div>
            </div>
          </form>

          {#if answeredCount > 0 && !ready}
            <form method="post" action="?/complete" use:enhance class="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-base-content/75 max-sm:order-last">
              <input type="hidden" name="accept_assumptions" value="1" />
              <button class="btn btn-sm btn-ghost px-2 underline underline-offset-3 max-sm:-ms-2 max-sm:h-11" type="submit" disabled={submitting}>Finish discovery</button>
              <span>Open topics become assumptions.</span>
            </form>
          {:else if ready}
            <form method="post" action="?/complete" use:enhance class="flex flex-wrap items-center gap-3 text-[13px] text-base-content/75 max-sm:order-last">
              <button class="btn btn-sm btn-outline" type="submit" disabled={submitting}>
                Finish discovery<ArrowRight class="size-3.5" aria-hidden="true" />
              </button>
              <span>You can stop here.</span>
            </form>
          {/if}
        {:else}
          <div class="card flex flex-col items-start gap-3 border border-line bg-base-100 p-6">
            <h2 class="text-[16px] font-semibold">No question waiting</h2>
            <p class="text-[13px] text-base-content/80">With AI connected, this is a paid call.</p>
            <form
              method="post"
              action="?/next"
              use:enhance={() => {
                submitting = true;
                return async ({ update }) => {
                  submitting = false;
                  await update();
                };
              }}
            >
              <button class="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
                {#if submitting}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Sparkles class="size-4" aria-hidden="true" />{/if}
                {submitting ? "Preparing questions…" : "Get next questions"}
              </button>
            </form>
          </div>
        {/if}
      </section>

      <aside class="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <button
          type="button"
          class="card flex min-h-14 w-full flex-row items-center gap-2.5 border border-line bg-base-100 px-4 text-left text-[14px] font-semibold text-base-content sm:hidden {briefOpen ? 'rounded-b-none border-b-0' : ''}"
          aria-expanded={briefOpen}
          aria-controls="discovery-brief"
          onclick={() => (briefOpen = !briefOpen)}
        >
          <span class="min-w-0 flex-1">Brief <span class="font-normal text-base-content/75">· {answeredCount} {answeredCount === 1 ? "answer" : "answers"}</span></span>
          <ChevronDown class="size-4 shrink-0 text-base-content/75 transition-transform {briefOpen ? 'rotate-180' : ''}" aria-hidden="true" />
        </button>
        {@render brief(d?.session?.status === "ACTIVE", true)}
      </aside>
    </div>
  {/if}
</main>
