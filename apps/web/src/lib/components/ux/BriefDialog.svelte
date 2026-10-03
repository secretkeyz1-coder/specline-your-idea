<script lang="ts">
  import { untrack } from "svelte";
  import { Compass, Plus, X } from "lucide-svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { UxVisualBrief } from "$lib/types.js";

  /**
   * The product brief (aturan.md §4 Lapis 1): who uses the product and where,
   * the devices that come first, the visual direction and its consequences,
   * what dominates the screens, and references and limits. The plan wrote it
   * from the requirements; what it had to guess is listed to review. Saving
   * it changes what the next draws, redraws and AI edits use — drawings
   * already made stay as they are.
   */
  let {
    open = $bindable(false),
    brief,
    editable,
    projectId,
    onSaved,
  }: {
    open?: boolean;
    brief: UxVisualBrief | null;
    editable: boolean;
    projectId: string;
    onSaved: () => Promise<void>;
  } = $props();

  const FIELDS: Array<{ key: "users" | "devices" | "direction" | "hierarchy" | "references"; label: string; hint: string; max: number }> = [
    { key: "users", label: "Users and context", hint: "Who uses it, the core job, how often, and where (a busy counter, a desk, on the move).", max: 500 },
    { key: "devices", label: "Main device", hint: "The device that comes first, and the sizes that must still work.", max: 300 },
    { key: "direction", label: "Visual direction", hint: "A concrete character and what it means, e.g. fast cashier → roomy touch targets, a scannable menu, the order always visible.", max: 600 },
    { key: "hierarchy", label: "Hierarchy and content", hint: "What leads: the information or action that dominates, and the role of photos, numbers, tables or editors.", max: 600 },
    { key: "references", label: "References and limits", hint: "References and which aspect to take from them, assets you have, and what to avoid.", max: 500 },
  ];

  type Draft = Omit<UxVisualBrief, "source">;
  const empty = (): Draft => ({ users: "", devices: "", direction: "", hierarchy: "", references: "", assumptions: [] });
  const fromBrief = (b: UxVisualBrief | null): Draft =>
    b ? { users: b.users, devices: b.devices, direction: b.direction, hierarchy: b.hierarchy, references: b.references, assumptions: [...b.assumptions] } : empty();

  let draft = $state<Draft>(untrack(() => fromBrief(brief)));
  let saving = $state(false);
  let failure = $state<string | null>(null);
  // Each time the dialog opens it shows what is stored now.
  $effect(() => {
    if (open) {
      untrack(() => {
        draft = fromBrief(brief);
        failure = null;
      });
    }
  });

  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(fromBrief(brief)));

  async function save() {
    saving = true;
    failure = null;
    try {
      const res = await fetch(`/projects/${projectId}/ux/brief`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: { ...draft, assumptions: draft.assumptions.map((a) => a.trim()).filter(Boolean) } }),
      });
      if (!res.ok) {
        const answer = (await res.json().catch(() => ({}))) as { message?: string };
        failure = answer.message ?? "The brief could not be saved. Try again.";
        return;
      }
      await onSaved();
      open = false;
    } catch {
      failure = "The connection dropped. Try again.";
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open dismissible={!saving} labelledby="brief-title" describedby="brief-desc" boxClass="flex max-h-[90dvh] max-w-[40rem] flex-col gap-4 overflow-y-auto p-5">
  <div class="flex items-start gap-3">
    <span class="grid size-9 shrink-0 place-items-center rounded-field border border-line bg-base-200"><Compass class="size-4" aria-hidden="true" /></span>
    <div class="min-w-0">
      <h2 id="brief-title" class="text-[16px] font-bold text-base-content">Product brief</h2>
      <p id="brief-desc" class="mt-0.5 text-[13px] text-base-content/80">
        What the screens are designed for.{#if brief?.source === "user"}{" "}Edited by you.{:else if brief}{" "}Written by the plan from the requirements.{/if}
        {#if editable}{" "}The next draws, redraws and AI edits use it; screens already drawn stay as they are until you redraw them.{/if}
      </p>
    </div>
  </div>

  {#if !brief && !editable}
    <p class="text-[13px] text-base-content/80">This reference was planned before product briefs existed.</p>
  {/if}

  {#if draft.assumptions.length || editable}
    <!-- What the plan had to guess: the part worth checking first. -->
    <section class="flex flex-col gap-2 rounded-box border border-warn/40 bg-warn-soft p-3" aria-labelledby="brief-assumptions">
      <h3 id="brief-assumptions" class="text-[13px] font-semibold text-base-content">To review{#if draft.assumptions.length}{" "}· {draft.assumptions.length}{/if}</h3>
      {#if draft.assumptions.length === 0}
        <p class="text-xs text-base-content/80">No assumptions — the requirements said enough.</p>
      {/if}
      <ul class="flex flex-col gap-1.5">
        {#each draft.assumptions as _, i (i)}
          <li class="flex items-start gap-1.5">
            {#if editable}
              <input class="input input-sm w-full bg-base-100" maxlength="240" aria-label={`Assumption ${i + 1}`} bind:value={draft.assumptions[i]} />
              <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0" aria-label={`Remove assumption ${i + 1}`} onclick={() => draft.assumptions.splice(i, 1)}><X class="size-3.5" aria-hidden="true" /></button>
            {:else}
              <span class="text-[13px] text-base-content">{draft.assumptions[i]}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if editable && draft.assumptions.length < 8}
        <button type="button" class="btn btn-ghost btn-xs self-start" onclick={() => draft.assumptions.push("")}><Plus class="size-3" aria-hidden="true" />Add an assumption</button>
      {/if}
    </section>
  {/if}

  <div class="flex flex-col gap-3.5">
    {#each FIELDS as f (f.key)}
      <div class="flex flex-col gap-1">
        <label class="text-[13px] font-semibold text-base-content" for={`brief-${f.key}`}>{f.label}</label>
        <p class="text-xs text-base-content/75" id={`brief-${f.key}-hint`}>{f.hint}</p>
        {#if editable}
          <textarea
            id={`brief-${f.key}`}
            class="textarea textarea-sm min-h-[64px] w-full"
            maxlength={f.max}
            aria-describedby={`brief-${f.key}-hint`}
            bind:value={draft[f.key]}
          ></textarea>
        {:else}
          <p id={`brief-${f.key}`} class="whitespace-pre-wrap text-[13px] text-base-content">{draft[f.key] || "—"}</p>
        {/if}
      </div>
    {/each}
  </div>

  {#if failure}<Notice tone="error">{failure}</Notice>{/if}

  <div class="flex justify-end gap-2">
    <button type="button" class="btn btn-ghost" onclick={() => (open = false)} disabled={saving}>{editable ? "Cancel" : "Close"}</button>
    {#if editable}
      <button type="button" class="btn btn-primary" onclick={save} disabled={saving || !dirty} aria-busy={saving}>
        {#if saving}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}Save brief
      </button>
    {/if}
  </div>
</Modal>
