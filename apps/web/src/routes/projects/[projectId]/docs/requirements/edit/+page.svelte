<script lang="ts">
  import { enhance } from "$app/forms";
  import { untrack } from "svelte";
  import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";

  type Verification = "TEST" | "MANUAL" | "REVIEW" | "METRIC";
  type Priority = "P0" | "P1" | "P2" | "P3";
  interface Criterion { key: string; statement: string; verification_type: Verification }
  interface Requirement { key: string; title: string; statement: string; priority: Priority; acceptance_criteria: Criterion[] }
  interface Doc {
    summary: string;
    actors: Array<{ name: string; description: string }>;
    workflows: Array<{ name: string; primary_actor: string; steps: string[] }>;
    functional_requirements: Requirement[];
    non_functional: Array<{ key: string; statement: string }>;
    assumptions: Array<{ description: string }>;
    exclusions: Array<{ description: string }>;
    open_questions: Array<{ description: string }>;
  }

  let {
    data,
    form,
  }: {
    data: { project: { id: string; name: string }; initial: Partial<Doc> | null; basedOn: { version: number; status: string } | null };
    form: { message?: string; payload?: string } | null;
  } = $props();

  const VERIFICATIONS: Array<{ value: Verification; label: string }> = [
    { value: "TEST", label: "Automated test" },
    { value: "MANUAL", label: "Manual check" },
    { value: "REVIEW", label: "Review" },
    { value: "METRIC", label: "Measurement" },
  ];

  const pad = (n: number) => String(n).padStart(2, "0");
  const blankCriterion = (): Criterion => ({ key: "", statement: "", verification_type: "TEST" });
  const blankRequirement = (n: number): Requirement => ({ key: `FR-${pad(n)}`, title: "", statement: "", priority: "P1", acceptance_criteria: [blankCriterion()] });
  const lines = (items: Array<{ description: string }> | undefined) => (items ?? []).map((i) => i.description).join("\n");

  // Start from what failed to save (nothing typed is lost), else the draft or
  // approved version, else one empty requirement.
  const start: Partial<Doc> = untrack(() => {
    if (form?.payload) {
      try {
        return JSON.parse(form.payload) as Doc;
      } catch {
        /* fall through */
      }
    }
    return data.initial ?? {};
  });

  let summary = $state(start.summary ?? "");
  let actors = $state((start.actors ?? []).map((a) => ({ name: a.name, description: a.description ?? "" })));
  let requirements = $state<Requirement[]>(
    start.functional_requirements?.length
      ? start.functional_requirements.map((r) => ({
          key: r.key,
          title: r.title,
          statement: r.statement,
          priority: r.priority ?? "P1",
          acceptance_criteria: r.acceptance_criteria?.length ? r.acceptance_criteria.map((c) => ({ ...c })) : [blankCriterion()],
        }))
      : [blankRequirement(1)],
  );
  let quality = $state((start.non_functional ?? []).map((n) => ({ ...n })));
  let workflows = $state((start.workflows ?? []).map((w) => ({ name: w.name, primary_actor: w.primary_actor ?? "", steps: w.steps.join("\n") })));
  let assumptions = $state(lines(start.assumptions));
  let exclusions = $state(lines(start.exclusions));
  let questions = $state(lines(start.open_questions));

  // Which requirement cards are open; kept in step with `requirements` (the first starts open).
  let openReq = $state<boolean[]>(untrack(() => requirements.map((_, i) => i === 0 || requirements.length <= 2)));

  // The optional sections start open when they already hold something (read once, so
  // clearing a field while typing does not fold the section away).
  const optionalOpen = untrack(() => ({ workflows: workflows.length > 0, scope: Boolean(assumptions || exclusions || questions) }));

  let saving = $state(false);
  let attempted = $state(false);

  const mode = $derived(
    !data.basedOn
      ? { title: "Write requirements", lead: "Write requirements", version: null, note: "Saved as a draft to approve." }
      : data.basedOn.status === "DRAFT"
        ? { title: `Edit requirements v${data.basedOn.version}`, lead: "Edit requirements", version: data.basedOn.version, note: `Saving creates draft v${data.basedOn.version + 1}.` }
        : { title: `Requirements v${data.basedOn.version + 1}`, lead: "Requirements", version: data.basedOn.version + 1, note: `v${data.basedOn.version} stays in use until you approve.` },
  );

  const KEY = /^[A-Z0-9-]+$/;
  const problems = $derived.by(() => {
    const out: string[] = [];
    if (!summary.trim()) out.push("Add a one-paragraph summary.");
    const keys = new Set<string>();
    requirements.forEach((r, i) => {
      const label = r.key || `Requirement ${i + 1}`;
      if (!KEY.test(r.key)) out.push(`${label}: the key may only use capital letters, digits and hyphens (for example FR-01).`);
      else if (keys.has(r.key)) out.push(`${label}: another requirement already uses this key.`);
      keys.add(r.key);
      if (!r.title.trim()) out.push(`${label}: add a title.`);
      if (!r.statement.trim()) out.push(`${label}: say what the system must do.`);
      if (!r.acceptance_criteria.some((c) => c.statement.trim())) out.push(`${label}: add at least one acceptance criterion.`);
    });
    return out;
  });

  // The first thing wrong with each requirement, shown on its (possibly folded) row.
  const reqIssues = $derived.by(() => {
    const seen = new Set<string>();
    return requirements.map((r) => {
      let msg: string | null = null;
      if (!KEY.test(r.key)) msg = "Key: capital letters, digits and hyphens only.";
      else if (seen.has(r.key)) msg = "Another requirement uses this key.";
      seen.add(r.key);
      if (msg) return msg;
      if (!r.title.trim()) return "Add a title.";
      if (!r.statement.trim()) return "Say what the system must do.";
      if (!r.acceptance_criteria.some((c) => c.statement.trim())) return "Add at least one acceptance criterion.";
      return null;
    });
  });

  function openProblems() {
    reqIssues.forEach((m, i) => {
      if (m) openReq[i] = true;
    });
  }
  function goToFirstProblem() {
    openProblems();
    const i = reqIssues.findIndex(Boolean);
    const target = !summary.trim() ? document.getElementById("summary") : i >= 0 ? document.getElementById(`req-${i}`) : null;
    if (!target) return;
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    (target instanceof HTMLDetailsElement ? target.querySelector("summary") : target)?.focus({ preventScroll: true });
  }

  const toItems = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((description) => ({ description }));

  const payload = $derived(
    JSON.stringify({
      summary: summary.trim(),
      actors: actors.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), description: a.description.trim() })),
      workflows: workflows
        .filter((w) => w.name.trim())
        .map((w) => ({ name: w.name.trim(), primary_actor: w.primary_actor.trim(), steps: w.steps.split("\n").map((s) => s.trim()).filter(Boolean) })),
      functional_requirements: requirements.map((r) => {
        const suffix = r.key.replace(/^[A-Z]+-/, "") || r.key;
        return {
          key: r.key,
          title: r.title.trim(),
          statement: r.statement.trim(),
          priority: r.priority,
          acceptance_criteria: r.acceptance_criteria
            .filter((c) => c.statement.trim())
            .map((c, j) => ({ key: c.key || `AC-${suffix}-${j + 1}`, statement: c.statement.trim(), verification_type: c.verification_type })),
        };
      }),
      non_functional: quality.filter((q) => q.statement.trim()).map((q, i) => ({ key: q.key.trim() || `NFR-${pad(i + 1)}`, statement: q.statement.trim() })),
      assumptions: toItems(assumptions),
      exclusions: toItems(exclusions),
      open_questions: toItems(questions),
    }),
  );

  // "Unsaved changes": anything typed since the page opened (a failed save is unsaved by definition).
  const baseline = untrack(() => (form?.payload ? "" : payload));
  const dirty = $derived(payload !== baseline);

  function nextKey(): string {
    let n = requirements.length + 1;
    while (requirements.some((r) => r.key === `FR-${pad(n)}`)) n++;
    return `FR-${pad(n)}`;
  }
</script>

<svelte:head>
  <title>{mode.title} — {data.project.name}</title>
</svelte:head>

<main class="mx-auto w-full max-w-[960px] max-sm:pb-12">
  <a class="btn btn-ghost btn-sm -ml-3 text-[13px] font-normal text-base-content/80 hover:text-base-content" href={`/projects/${data.project.id}/docs?tab=requirements`}>
    <ArrowLeft class="size-3.5" aria-hidden="true" />Requirements
  </a>
  <header class="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h1 class="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
        {mode.lead}{#if mode.version !== null}&nbsp;<span class="font-mono font-medium tracking-tighter">v{mode.version}</span>{/if}
      </h1>
      <p class="text-[14px] text-base-content/80">{mode.note}</p>
    </div>
    {#if dirty}
      <p class="flex items-center gap-2 text-[13px] text-base-content/80">
        <span class="size-2 rounded-full bg-warn" aria-hidden="true"></span>Unsaved changes
      </p>
    {/if}
  </header>

  {#if form?.message}
    <Notice tone="error" class="mt-4">{form.message}</Notice>
  {/if}

  <form
    method="post"
    action="?/save"
    class="mt-6 flex flex-col gap-8 sm:mt-8 sm:gap-10"
    use:enhance={({ cancel }) => {
      attempted = true;
      if (problems.length) {
        openProblems();
        cancel();
        return;
      }
      saving = true;
      return async ({ update }) => {
        saving = false;
        await update({ reset: false });
      };
    }}
  >
    <input type="hidden" name="payload" value={payload} />

    <!-- Summary + who uses it, side by side from lg -->
    <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <section aria-labelledby="sec-summary" class="flex flex-col gap-2">
        <h2 id="sec-summary" class="text-[18px] font-bold">Summary</h2>
        <label for="summary" class="sr-only">What the product is and who it is for, in a paragraph.</label>
        <textarea
          id="summary"
          class="textarea min-h-[88px] w-full resize-y text-[14px] leading-relaxed sm:min-h-[112px]"
          placeholder="What the product is and who it is for"
          bind:value={summary}
          maxlength="4000"
          aria-invalid={attempted && !summary.trim()}
        ></textarea>
      </section>

      <!-- Phones: "Add user" sits beside the heading, as a grid reorder of the same button. -->
      <section aria-labelledby="sec-actors" class="flex flex-col gap-2 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center">
        <h2 id="sec-actors" class="text-[18px] font-bold max-sm:-order-2">Who uses it</h2>
        {#each actors as actor, i (i)}
          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1.5 gap-y-1.5 border-b border-line pb-2 last-of-type:border-0 max-sm:col-span-2">
            <input class="input w-full text-[14px]" aria-label={`Actor ${i + 1} name`} placeholder="e.g. Team lead" bind:value={actor.name} maxlength="120" />
            <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove actor ${i + 1}`} onclick={() => actors.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
            <input class="input col-span-2 w-full text-[14px]" aria-label={`Actor ${i + 1} description`} placeholder="What they do" bind:value={actor.description} maxlength="600" />
          </div>
        {/each}
        <button type="button" class="btn btn-ghost btn-sm self-start max-sm:-order-1 max-sm:-me-2 max-sm:h-11 max-sm:self-center" onclick={() => actors.push({ name: "", description: "" })}>
          <Plus class="size-4" aria-hidden="true" />Add user
        </button>
      </section>
    </div>

    <section aria-labelledby="sec-fr" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sec-fr" class="text-[18px] font-bold">Functional requirements</h2>
        <button
          type="button"
          class="btn btn-outline btn-sm max-sm:btn-square max-sm:size-11"
          onclick={() => {
            requirements.push({ ...blankRequirement(1), key: nextKey() });
            openReq.push(true);
          }}
        >
          <Plus class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">Add requirement</span>
        </button>
      </div>
      {#each requirements as req, i (i)}
        {@const issue = attempted ? reqIssues[i] : null}
        <details
          id={`req-${i}`}
          class="group rounded-box border bg-base-100 {openReq[i] ? 'border-primary-ink' : issue ? 'border-danger/40' : 'border-line'}"
          bind:open={openReq[i]}
        >
          <summary
            class="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-box px-4 py-2.5 [&::-webkit-details-marker]:hidden {issue && !openReq[i] ? 'bg-danger-soft' : ''}"
            aria-describedby={issue ? `req-${i}-err` : undefined}
          >
            <ChevronRight class="size-4 shrink-0 text-base-content/80 transition-transform group-open:rotate-90" aria-hidden="true" />
            <span class="w-16 shrink-0 font-mono text-[13px] text-base-content/80">{req.key || "—"}</span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[14px] font-semibold">{req.title.trim() || "Untitled"}</span>
              {#if issue}<span id={`req-${i}-err`} class="text-xs text-danger">{issue}</span>{/if}
            </span>
            <span class="badge badge-sm shrink-0 font-mono {req.priority === 'P0' ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line bg-base-200 text-base-content/80'}">{req.priority}</span>
          </summary>
          <fieldset class="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-4 sm:px-5">
            <legend class="sr-only">Requirement {req.key || i + 1}</legend>
            <div class="grid grid-cols-[minmax(0,1fr)_96px] gap-3 sm:grid-cols-[120px_96px_minmax(0,1fr)]">
              <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content/80">
                Key
                <input
                  class="input w-full font-mono text-[14px] uppercase"
                  bind:value={req.key}
                  oninput={(e) => (req.key = e.currentTarget.value.toUpperCase())}
                  maxlength="32"
                  aria-invalid={attempted && !KEY.test(req.key)}
                />
              </label>
              <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content/80">
                Priority
                <select class="select w-full font-mono text-[14px]" bind:value={req.priority}>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </label>
              <label class="col-span-2 flex min-w-0 flex-col gap-1 text-[13px] font-medium text-base-content/80 sm:col-span-1">
                Title
                <input class="input w-full text-[14px]" bind:value={req.title} maxlength="200" aria-invalid={attempted && !req.title.trim()} />
              </label>
            </div>
            <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content/80">
              What the system must do
              <textarea class="textarea min-h-[76px] w-full resize-y text-[14px] leading-relaxed" bind:value={req.statement} maxlength="1500" aria-invalid={attempted && !req.statement.trim()}></textarea>
            </label>
            <div class="flex flex-col gap-2">
              <div class="hidden grid-cols-[minmax(0,1fr)_168px_44px] gap-2 text-[13px] font-medium text-base-content/80 sm:grid">
                <p>Acceptance criteria</p>
                <p>Checked by</p>
              </div>
              <p class="text-[13px] font-medium text-base-content/80 sm:hidden">Acceptance criteria</p>
              {#each req.acceptance_criteria as ac, j (j)}
                <div class="grid grid-cols-[minmax(0,1fr)_44px] gap-2 sm:grid-cols-[minmax(0,1fr)_168px_44px] sm:items-center">
                  <input class="input w-full text-[14px] max-sm:col-span-2" aria-label={`${req.key} criterion ${j + 1}`} placeholder="Something someone can check, e.g. “Two votes from one device count once”" bind:value={ac.statement} maxlength="800" />
                  <select class="select w-full text-[14px]" aria-label={`${req.key} criterion ${j + 1} checked by`} bind:value={ac.verification_type}>
                    {#each VERIFICATIONS as v (v.value)}<option value={v.value}>{v.label}</option>{/each}
                  </select>
                  {#if req.acceptance_criteria.length > 1}
                    <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove ${req.key} criterion ${j + 1}`} onclick={() => req.acceptance_criteria.splice(j, 1)}>
                      <Trash2 class="size-4" aria-hidden="true" />
                    </button>
                  {/if}
                </div>
              {/each}
              <div class="flex flex-wrap items-center justify-between gap-2">
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => req.acceptance_criteria.push(blankCriterion())}>
                  <Plus class="size-4" aria-hidden="true" />Add criterion
                </button>
                {#if requirements.length > 1}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm text-danger"
                    aria-label={`Remove ${req.key || `requirement ${i + 1}`}`}
                    onclick={() => {
                      requirements.splice(i, 1);
                      openReq.splice(i, 1);
                    }}
                  >
                    <Trash2 class="size-4" aria-hidden="true" />Remove {req.key || "requirement"}
                  </button>
                {/if}
              </div>
            </div>
          </fieldset>
        </details>
      {/each}
    </section>

    <section aria-labelledby="sec-nfr" class="flex flex-col gap-2">
      <h2 id="sec-nfr" class="text-[18px] font-bold">Quality needs</h2>
      <p class="text-[13px] text-base-content/80">Say how each is checked.</p>
      {#each quality as q, i (i)}
        <div class="grid grid-cols-[112px_minmax(0,1fr)_auto] gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
          <input class="input w-full font-mono text-[14px] uppercase" aria-label={`Quality need ${i + 1} key`} placeholder={`NFR-${pad(i + 1)}`} bind:value={q.key} maxlength="32" />
          <input class="input w-full text-[14px] max-sm:order-last max-sm:col-span-2" aria-label={`Quality need ${i + 1}`} placeholder="e.g. Pages load in under 1 s on a phone, measured with Lighthouse" bind:value={q.statement} maxlength="800" />
          <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove quality need ${i + 1}`} onclick={() => quality.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
        </div>
      {/each}
      <button type="button" class="btn btn-ghost btn-sm self-start" onclick={() => quality.push({ key: "", statement: "" })}>
        <Plus class="size-4" aria-hidden="true" />Add quality need
      </button>
    </section>

    <!-- Optional sections behind labelled toggles -->
    <div class="flex flex-col gap-3">
      <details class="collapse collapse-arrow rounded-box border border-line bg-base-100" open={optionalOpen.workflows}>
        <summary class="collapse-title min-h-13 text-[14px] font-semibold">Workflows <span class="font-normal text-base-content/80">optional</span></summary>
        <div class="collapse-content flex flex-col gap-3">
          {#each workflows as wf, i (i)}
            <div class="flex flex-col gap-2 border-b border-line pb-3 last:border-0">
              <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
                <input class="input w-full text-[14px]" aria-label={`Workflow ${i + 1} name`} placeholder="e.g. Cast a vote" bind:value={wf.name} maxlength="160" />
                <input class="input w-full text-[14px]" aria-label={`Workflow ${i + 1} actor`} placeholder="Who" bind:value={wf.primary_actor} maxlength="120" />
                <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove workflow ${i + 1}`} onclick={() => workflows.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
              </div>
              <textarea class="textarea min-h-[72px] w-full resize-y text-[14px]" aria-label={`Workflow ${i + 1} steps, one per line`} placeholder="One step per line" bind:value={wf.steps}></textarea>
            </div>
          {/each}
          <button type="button" class="btn btn-ghost btn-sm self-start" onclick={() => workflows.push({ name: "", primary_actor: "", steps: "" })}>
            <Plus class="size-4" aria-hidden="true" />Add workflow
          </button>
        </div>
      </details>

      <details class="collapse collapse-arrow rounded-box border border-line bg-base-100" open={optionalOpen.scope}>
        <summary class="collapse-title min-h-13 text-[14px] font-semibold">Scope notes <span class="font-normal text-base-content/80">optional</span></summary>
        <section aria-label="Scope notes" class="collapse-content grid gap-4 md:grid-cols-3">
          <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content">
            Assumptions
            <textarea class="textarea min-h-[96px] w-full resize-y text-[14px] font-normal" placeholder="One per line" bind:value={assumptions}></textarea>
          </label>
          <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content">
            Out of scope
            <textarea class="textarea min-h-[96px] w-full resize-y text-[14px] font-normal" placeholder="One per line" bind:value={exclusions}></textarea>
          </label>
          <label class="flex flex-col gap-1 text-[13px] font-medium text-base-content">
            Open questions
            <textarea class="textarea min-h-[96px] w-full resize-y text-[14px] font-normal" placeholder="One per line" bind:value={questions}></textarea>
          </label>
        </section>
      </details>
    </div>

    <!-- Save stays in reach on a long form; primary last. On phones it is the bottom bar, over the next-step bar. -->
    <div class="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-t-box border-t border-line bg-base-100 px-4 py-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mx-0 max-sm:rounded-none max-sm:ps-4 max-sm:pe-3 max-sm:pt-2.5 max-sm:pb-[max(0.875rem,env(safe-area-inset-bottom))] max-sm:shadow-[0_-4px_16px_rgb(0_0_0/0.06)]">
      <div class="min-w-0 flex-1 text-[13px]" aria-live="polite">
        {#if attempted && problems.length}
          <p class="flex flex-wrap items-center gap-2">
            <span class="badge badge-sm border-danger/40 bg-danger-soft text-danger">{problems.length} to fix</span>
            <span class="text-base-content/80 max-sm:hidden">{problems[0]}</span>
            <button type="button" class="link font-semibold text-primary-ink no-underline hover:underline" onclick={goToFirstProblem}>Go to it</button>
          </p>
          {#if problems.length > 1}
            <details class="mt-1">
              <summary class="cursor-pointer text-xs text-base-content/80">Show all</summary>
              <ul class="mt-1 list-disc pl-5 text-xs text-base-content/80">
                {#each problems as p (p)}<li>{p}</li>{/each}
              </ul>
            </details>
          {/if}
        {:else}
          <p class="text-base-content/80">{requirements.length} {requirements.length === 1 ? "requirement" : "requirements"}</p>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <a class="btn btn-ghost max-sm:h-12" href={`/projects/${data.project.id}/docs?tab=requirements`}>Cancel</a>
        <button class="btn btn-primary max-sm:btn-lg" type="submit" disabled={saving}>
          {#if saving}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Saving…{:else}Save draft{/if}
        </button>
      </div>
    </div>
  </form>
</main>
