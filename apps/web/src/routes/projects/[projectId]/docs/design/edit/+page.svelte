<script lang="ts">
  import { enhance } from "$app/forms";
  import { untrack } from "svelte";
  import { ArrowLeft, Plus, Trash2 } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";

  import { designReadinessIssues } from "@sdd/contracts";
  import { designEditorInitial, initialCoverage, designEditorPayload, type DeliveryCheck } from "$lib/design-editor.js";

  interface Component { name: string; responsibility: string; interfaces: string }
  interface Decision { description: string; blocking: boolean }
  interface Doc {
    overview: string;
    architecture: { summary: string; diagram_text: string };
    components: Component[];
    data_model: string;
    api_contracts: string;
    state_machines: string;
    testing_strategy: string;
    security: string;
    deployment: string;
    unresolved_decisions: Decision[];
    requirement_coverage: import("@sdd/contracts").DesignArtifact["requirement_coverage"];
    delivery_checks: DeliveryCheck[];
  }

  let {
    data,
    form,
  }: {
    data: {
      project: { id: string; name: string };
      initial: Partial<Doc> | null;
      basedOn: { version: number; status: string } | null;
      requirementsApproved: boolean;
      requirements: Array<{ key: string; title: string }>;
      stackLocked: boolean;
    };
    form: { message?: string; payload?: string } | null;
  } = $props();

  const start: Partial<Doc> = untrack(() => {
    if (form?.payload) {
      try {
        return designEditorInitial(JSON.parse(form.payload));
      } catch {
        /* fall through */
      }
    }
    return designEditorInitial(data.initial);
  });

  let overview = $state(start.overview ?? "");
  let archSummary = $state(start.architecture?.summary ?? "");
  let diagram = $state(start.architecture?.diagram_text ?? "");
  let components = $state<Component[]>((start.components ?? []).map((c) => ({ name: c.name, responsibility: c.responsibility, interfaces: c.interfaces ?? "" })));
  let dataModel = $state(start.data_model ?? "");
  let contracts = $state(start.api_contracts ?? "");
  let states = $state(start.state_machines ?? "");
  let testing = $state(start.testing_strategy ?? "");
  let security = $state(start.security ?? "");
  let deployment = $state(start.deployment ?? "");
  let decisions = $state<Decision[]>((start.unresolved_decisions ?? []).map((d) => ({ description: d.description, blocking: Boolean(d.blocking) })));
  if (components.length === 0) components.push({ name: "", responsibility: "", interfaces: "" });

  let coverage = $state(untrack(() => initialCoverage(start, data.requirements.map(r => r.key))));
  let checks = $state<DeliveryCheck[]>((start.delivery_checks ?? []).map(c => ({ ...c, expected_paths: [...c.expected_paths] })));

  let saving = $state(false);
  let attempted = $state(false);
  const ready = $derived(data.requirementsApproved && data.stackLocked);

  const mode = $derived(
    !data.basedOn
      ? { title: "Write the technical design", lead: "Technical design", version: null, note: "Saved as a draft to approve." }
      : data.basedOn.status === "DRAFT"
        ? { title: `Edit design draft v${data.basedOn.version}`, lead: "Edit technical design", version: data.basedOn.version, note: `Saving creates draft v${data.basedOn.version + 1}.` }
        : { title: `Start design version ${data.basedOn.version + 1}`, lead: "Technical design", version: data.basedOn.version + 1, note: `v${data.basedOn.version} stays in use until you approve.` },
  );

  const problems = $derived.by(() => {
    const out: string[] = [];
    if (!overview.trim()) out.push("Add an overview.");
    if (!archSummary.trim()) out.push("Describe the architecture.");
    if (!components.some((c) => c.name.trim() && c.responsibility.trim())) out.push("Add at least one component with its responsibility.");
    if (!dataModel.trim()) out.push("Describe the data model.");
    if (!testing.trim()) out.push("Say how the work is tested.");
    return out;
  });

  // Where each problem lives, in the same order as `problems`: "Go to it" jumps to the first.
  const firstProblemAt = $derived(
    !overview.trim()
      ? "overview"
      : !archSummary.trim()
        ? "arch"
        : !components.some((c) => c.name.trim() && c.responsibility.trim())
          ? "component-0-name"
          : !dataModel.trim()
            ? "data-model"
            : !testing.trim()
              ? "testing"
              : null,
  );
  function goToFirstProblem() {
    const el = firstProblemAt ? document.getElementById(firstProblemAt) : null;
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }

  const payload = $derived(
    JSON.stringify(designEditorPayload({
      overview: overview.trim(),
      architecture: { summary: archSummary.trim(), diagram_text: diagram.trim() },
      components: components
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), responsibility: c.responsibility.trim(), interfaces: c.interfaces.trim() })),
      data_model: dataModel.trim(),
      api_contracts: contracts.trim(),
      state_machines: states.trim(),
      testing_strategy: testing.trim(),
      security: security.trim(),
      deployment: deployment.trim(),
      unresolved_decisions: decisions.filter((d) => d.description.trim()).map((d) => ({ description: d.description.trim(), blocking: d.blocking })),
    }, coverage, checks)),
  );
  const approvalIssues = $derived(designReadinessIssues(JSON.parse(payload), data.requirements.map(r => r.key)));

  // The optional sections, behind one "More detail" disclosure (open when one already holds text).
  const OPTIONAL = [
    { id: "contracts", label: "API contracts", hint: "Endpoints or functions, inputs and outputs. State explicitly if not applicable." },
    { id: "states", label: "State machines & workflows", hint: "States, transitions and who triggers them." },
    { id: "security", label: "Security", hint: "Auth, data access, secrets." },
    { id: "deployment", label: "Deployment", hint: "Where it runs, env vars, ports." },
  ] as const;
  const moreOpen = untrack(() => Boolean(contracts || states || security || deployment));

  // "Unsaved changes": anything typed since the page opened (a failed save is unsaved by definition).
  const baseline = untrack(() => (form?.payload ? "" : payload));
  const dirty = $derived(payload !== baseline);
</script>

<svelte:head>
  <title>{mode.title} — {data.project.name}</title>
</svelte:head>

<main class="mx-auto w-full max-w-[1000px] max-sm:pb-12">
  <a class="btn btn-ghost btn-sm -ml-3 text-[13px] font-normal text-base-content/80 hover:text-base-content" href={`/projects/${data.project.id}/docs?tab=design`}>
    <ArrowLeft class="size-3.5" aria-hidden="true" />Technical design
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

  {#if !ready}
    <Notice tone="warn" class="mt-4">
      {#if !data.requirementsApproved}
        Approve the requirements first — <a class="font-medium underline underline-offset-2" href={`/projects/${data.project.id}/docs?tab=requirements`}>open requirements</a>.
      {:else}
        Lock the stack first — <a class="font-medium underline underline-offset-2" href={`/projects/${data.project.id}/stack`}>choose the stack</a>.
      {/if}
    </Notice>
  {/if}

  {#if form?.message}
    <Notice tone="error" class="mt-4">{form.message}</Notice>
  {/if}

  {#if data.requirements.length}
    <details class="collapse collapse-arrow mt-5 rounded-box border border-line bg-base-100 text-[13px]">
      <summary class="collapse-title min-h-12 py-3 font-semibold">Requirements to cover <span class="font-mono text-xs font-normal text-base-content/75">{data.requirements.length}</span></summary>
      <ul class="collapse-content grid gap-1 text-base-content/80 sm:grid-cols-2">
        {#each data.requirements as r (r.key)}<li><span class="font-mono text-xs font-medium tracking-tight text-base-content/75">{r.key}</span> {r.title}</li>{/each}
      </ul>
    </details>
  {/if}

  <form
    method="post"
    action="?/save"
    class="mt-6 flex flex-col gap-7 sm:mt-8 sm:gap-9"
    use:enhance={({ cancel }) => {
      attempted = true;
      if (problems.length || !ready) {
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

    <section aria-labelledby="sec-overview" class="flex flex-col gap-2">
      <h2 id="sec-overview" class="text-[18px] font-bold">Overview</h2>
      <label for="overview" class="text-[13px] text-base-content/80">The approach in a paragraph.</label>
      <textarea id="overview" class="textarea min-h-[88px] w-full resize-y text-[14px] leading-relaxed" bind:value={overview} maxlength="4000" aria-invalid={attempted && !overview.trim()}></textarea>
    </section>

    <section aria-labelledby="sec-arch" class="flex flex-col gap-2">
      <h2 id="sec-arch" class="text-[18px] font-bold">Architecture</h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <label for="arch" class="text-[13px] font-medium text-base-content/80">How the parts fit together</label>
          <textarea id="arch" class="textarea min-h-[88px] sm:min-h-[104px] w-full resize-y text-[14px] leading-relaxed" bind:value={archSummary} maxlength="3000" aria-invalid={attempted && !archSummary.trim()}></textarea>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="diagram" class="text-[13px] font-medium text-base-content/80">Diagram <span class="font-normal text-base-content/75">optional</span></label>
          <textarea id="diagram" class="textarea min-h-[92px] sm:min-h-[104px] w-full resize-y font-mono text-[13px] leading-relaxed" placeholder="Browser → Flask routes → SQLite" bind:value={diagram} maxlength="4000"></textarea>
        </div>
      </div>
    </section>

    <section aria-labelledby="sec-components" class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sec-components" class="text-[18px] font-bold">Components</h2>
        <button type="button" class="btn btn-ghost btn-sm max-sm:-me-2 max-sm:h-11" onclick={() => components.push({ name: "", responsibility: "", interfaces: "" })}>
          <Plus class="size-4" aria-hidden="true" />Add component
        </button>
      </div>
      <div class="hidden grid-cols-[168px_minmax(0,1fr)_minmax(0,0.9fr)_44px] gap-2 text-[13px] font-medium text-base-content/80 md:grid" aria-hidden="true">
        <p>Name</p><p>Does</p><p>Interfaces</p>
      </div>
      {#each components as c, i (i)}
        <div class="grid grid-cols-[minmax(0,1fr)_44px] gap-2 border-b border-line pb-2 last-of-type:border-0 max-sm:gap-1.5 max-sm:pb-3 md:grid-cols-[168px_minmax(0,1fr)_minmax(0,0.9fr)_44px] md:border-0 md:pb-0">
          <input id={`component-${i}-name`} class="input w-full font-mono text-[13px]" aria-label={`Component ${i + 1} name`} placeholder="e.g. poll_store" bind:value={c.name} maxlength="120" />
          <input class="input w-full text-[14px] max-md:order-last max-md:col-span-2" aria-label={`Component ${i + 1} responsibility`} placeholder="What it is responsible for" bind:value={c.responsibility} maxlength="800" />
          <input class="input w-full font-mono text-[13px] max-md:order-last max-md:col-span-2" aria-label={`Component ${i + 1} interfaces`} placeholder="Interfaces (optional)" bind:value={c.interfaces} maxlength="800" />
          {#if components.length > 1}
            <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove component ${i + 1}`} onclick={() => components.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
          {:else}
            <span aria-hidden="true"></span>
          {/if}
        </div>
      {/each}
    </section>

    <div class="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-4">
      <section class="flex flex-col gap-2" aria-labelledby="sec-data-model">
        <h2 id="sec-data-model" class="text-[18px] font-bold">Data model</h2>
        <label for="data-model" class="text-[13px] text-base-content/80">Entities, fields and relations — a schema sketch is fine.</label>
        <textarea id="data-model" class="textarea min-h-[112px] sm:min-h-[136px] w-full resize-y font-mono text-[13px] leading-relaxed" bind:value={dataModel} maxlength="8000" aria-invalid={attempted && !dataModel.trim()}></textarea>
      </section>
      <section class="flex flex-col gap-2" aria-labelledby="sec-testing">
        <h2 id="sec-testing" class="text-[18px] font-bold">Testing strategy</h2>
        <label for="testing" class="text-[13px] text-base-content/80">The command that proves each requirement.</label>
        <textarea id="testing" class="textarea min-h-[88px] sm:min-h-[136px] w-full resize-y text-[14px]" bind:value={testing} maxlength="4000" aria-invalid={attempted && !testing.trim()}></textarea>
      </section>
    </div>

    <section aria-labelledby="sec-coverage" class="flex flex-col gap-3">
      <h2 id="sec-coverage" class="text-[18px] font-bold">Requirement coverage</h2>
      <p class="text-[13px] text-base-content/80">For each approved requirement, name a populated section or component and explicitly assess its implementation path. Text alone does not establish coverage.</p>
      {#each coverage as c, i (c.requirement_key)}
        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
          <p class="text-[13px]"><span class="font-mono">{c.requirement_key}</span> {data.requirements.find(r => r.key === c.requirement_key)?.title}</p>
          <input class="input w-full" aria-label={`Design section for ${c.requirement_key}`} placeholder="e.g. components: poll_store" maxlength="160" bind:value={c.design_section} />
          <select class="select w-full" aria-label={`Coverage status for ${c.requirement_key}`} bind:value={c.status}>
            <option value="NO_PATH">No path</option><option value="PARTIAL">Partial</option><option value="PATH_DEFINED">Path defined</option>
          </select>
        </div>
      {/each}
    </section>

    <section aria-labelledby="sec-delivery" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sec-delivery" class="text-[18px] font-bold">Delivery checks</h2>
        <button type="button" class="btn btn-ghost btn-sm" disabled={checks.length >= 6} onclick={() => checks.push({ purpose: "build", command: "", expected_paths: [], outcome: "" })}><Plus class="size-4" aria-hidden="true" />Add check</button>
      </div>
      <p class="text-[13px] text-base-content/80">Define bounded executable checks for build, startup and a core journey. Use a test fixture that stops the app, not a long-running server. These commands are plans, not executed here.</p>
      {#each checks as c, i (i)}
        <div class="grid gap-2 rounded-box border border-line p-3">
          <div class="flex gap-2">
            <select class="select flex-1" aria-label={`Delivery check ${i + 1} purpose`} bind:value={c.purpose}><option value="build">Build</option><option value="startup">Startup</option><option value="journey">Journey</option><option value="deployment">Deployment</option></select>
            <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove delivery check ${i + 1}`} onclick={() => checks.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
          </div>
          <input class="input w-full font-mono" aria-label={`Delivery check ${i + 1} command`} placeholder="npm run test:startup" maxlength="400" bind:value={c.command} />
          <textarea class="textarea w-full" aria-label={`Delivery check ${i + 1} expected paths, one per line`} placeholder="Expected paths, one per line (optional)" value={c.expected_paths.join(String.fromCharCode(10))} oninput={(event) => c.expected_paths = event.currentTarget.value.split(String.fromCharCode(10))}></textarea>
          <input class="input w-full" aria-label={`Delivery check ${i + 1} outcome`} placeholder="Observable passing outcome" maxlength="800" bind:value={c.outcome} />
        </div>
      {/each}
    </section>

    <Notice tone={approvalIssues.length ? "warn" : "success"}>
      {#if approvalIssues.length}
        <p class="font-semibold">Draft needs changes before approval. You can still save it.</p>
        <ul class="mt-2 list-disc pl-5">{#each approvalIssues as issue}<li>{issue}</li>{/each}</ul>
      {:else}Material design checks pass. Save and review the draft before approval.{/if}
    </Notice>

    <details class="collapse collapse-arrow rounded-box border border-line bg-base-100" open={moreOpen}>
      <summary class="collapse-title min-h-13 text-[14px] font-semibold">Approval detail <span class="font-normal text-base-content/80">state explicitly when not applicable</span></summary>
      <div class="collapse-content flex flex-col gap-6">
        {#each OPTIONAL as f (f.id)}
          <section class="flex flex-col gap-1.5" aria-labelledby={`sec-${f.id}`}>
            <h3 id={`sec-${f.id}`} class="text-[14px] font-semibold">{f.label}</h3>
            <label for={f.id} class="text-[13px] text-base-content/80">{f.hint}</label>
            {#if f.id === "contracts"}
              <textarea id={f.id} class="textarea min-h-[100px] w-full resize-y font-mono text-[13px]" bind:value={contracts} maxlength="8000"></textarea>
            {:else if f.id === "states"}
              <textarea id={f.id} class="textarea min-h-[88px] w-full resize-y text-[14px]" bind:value={states} maxlength="6000"></textarea>
            {:else if f.id === "security"}
              <textarea id={f.id} class="textarea min-h-[72px] w-full resize-y text-[14px]" bind:value={security} maxlength="4000"></textarea>
            {:else}
              <textarea id={f.id} class="textarea min-h-[72px] w-full resize-y text-[14px]" bind:value={deployment} maxlength="3000"></textarea>
            {/if}
          </section>
        {/each}
      </div>
    </details>

    <section aria-labelledby="sec-decisions" class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sec-decisions" class="text-[18px] font-bold">Open decisions <span class="text-[14px] font-normal text-base-content/80">optional</span></h2>
        <button type="button" class="btn btn-ghost btn-sm max-sm:-me-2 max-sm:h-11" onclick={() => decisions.push({ description: "", blocking: false })}>
          <Plus class="size-4" aria-hidden="true" />Add decision
        </button>
      </div>
      {#each decisions as d, i (i)}
        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input class="input w-full text-[14px] max-sm:col-span-2" aria-label={`Decision ${i + 1}`} bind:value={d.description} maxlength="600" />
          <label class="flex min-h-10 items-center gap-2 whitespace-nowrap text-[13px] text-base-content/80 max-sm:min-h-11 max-sm:px-1"><input type="checkbox" class="checkbox checkbox-sm checkbox-primary" bind:checked={d.blocking} />Blocks the build</label>
          <button type="button" class="btn btn-ghost btn-square" aria-label={`Remove decision ${i + 1}`} onclick={() => decisions.splice(i, 1)}><Trash2 class="size-4" aria-hidden="true" /></button>
        </div>
      {/each}
    </section>

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
              <ul class="mt-1 list-disc pl-5 text-xs text-base-content/80">{#each problems as p (p)}<li>{p}</li>{/each}</ul>
            </details>
          {/if}
        {:else}
          <p class="text-base-content/80">Coverage is checked on save.</p>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <a class="btn btn-ghost max-sm:h-12" href={`/projects/${data.project.id}/docs?tab=design`}>Cancel</a>
        <button class="btn btn-primary max-sm:btn-lg" type="submit" disabled={saving || !ready}>
          {#if saving}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Saving…{:else}Save draft{/if}
        </button>
      </div>
    </div>
  </form>
</main>
