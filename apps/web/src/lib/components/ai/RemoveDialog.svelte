<script lang="ts">
  import { enhance } from "$app/forms";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { Trash2 } from "lucide-svelte";
  import { blockers, usageOf } from "$lib/ai-settings.js";

  /** Delete a connection or profile — or, while roles still use it, say which and offer the way out. */
  let {
    removing = $bindable(null),
    busy = $bindable(null),
    item,
    onOpenRoles,
  }: {
    removing: { kind: "provider" | "profile"; id: string; name: string } | null;
    busy: string | null;
    /** The connection or profile being removed, with its usage. */
    item: Record<string, unknown> | null;
    onOpenRoles: () => void;
  } = $props();

  const removingBlockers = $derived(item ? blockers(item) : []);
</script>

<Modal sheetOnPhone open={removing !== null} onclose={() => (removing = null)} labelledby="remove-title" describedby="remove-desc" boxClass="flex max-w-[460px] flex-col rounded-box border border-line p-5 sm:p-7">
  {#if removing}
    {@const target = removing}
    {@const isProvider = target.kind === "provider"}
    {@const unusedProfiles = usageOf(item ?? {}).profiles ?? 0}
    <h2 id="remove-title" class="text-[20px] font-bold tracking-tight text-base-content">
      Delete {isProvider ? "connection" : "profile"} “{target.name}”?
    </h2>

    {#if removingBlockers.length}
      <p id="remove-desc" class="mt-2 text-[13px] leading-relaxed text-base-content/80">
        It can't be deleted while roles use it:
      </p>
      <ul class="mt-1.5 list-disc pl-5 text-[13px] text-base-content">
        {#each removingBlockers as b (b)}<li>{b}</li>{/each}
      </ul>
      <p class="mt-2 text-[13px] leading-relaxed text-base-content/80">
        Rebind or unbind those roles under Role routing first{isProvider ? ", or disable the connection to stop using it and keep its settings" : ""}.
      </p>
      <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4 max-sm:flex-col-reverse max-sm:flex-nowrap max-sm:items-stretch">
        <button type="button" class="btn btn-ghost" onclick={() => (removing = null)}>Close</button>
        <button type="button" class="btn btn-outline" onclick={() => { removing = null; onOpenRoles(); }}>Open role routing</button>
        {#if isProvider && item?.status !== "DISABLED"}
          <form
            method="post"
            action="?/setProviderStatus"
            use:enhance={() => {
              busy = "remove";
              return async ({ update }) => {
                busy = null;
                removing = null;
                await update();
              };
            }}
          >
            <input type="hidden" name="providerId" value={target.id} />
            <input type="hidden" name="status" value="DISABLED" />
            <button class="btn btn-primary max-sm:btn-lg max-sm:w-full" type="submit" disabled={busy !== null}>Disable connection</button>
          </form>
        {/if}
      </div>
    {:else}
      <p id="remove-desc" class="mt-2 text-[13px] leading-relaxed text-base-content/80">
        {#if isProvider}
          The connection{unusedProfiles ? ` and its ${unusedProfiles} unused profile${unusedProfiles === 1 ? "" : "s"}` : ""} will be removed, with its stored key. Past AI runs stay in the history.
        {:else}
          The profile will be removed. Past AI runs stay in the history.
        {/if}
        This can't be undone.
      </p>
      <form
        method="post"
        action={isProvider ? "?/deleteProvider" : "?/deleteProfile"}
        use:enhance={() => {
          busy = "remove";
          return async ({ update }) => {
            busy = null;
            removing = null;
            await update();
          };
        }}
        class="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4 max-sm:flex-col-reverse max-sm:items-stretch"
      >
        <input type="hidden" name={isProvider ? "providerId" : "profileId"} value={target.id} />
        <button type="button" class="btn btn-ghost" onclick={() => (removing = null)}>Cancel</button>
        <button class="btn border-danger/40 bg-danger-soft text-danger max-sm:btn-lg" type="submit" disabled={busy !== null}>
          {#if busy === "remove"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Trash2 class="size-3.5" aria-hidden="true" />{/if}
          <span>Delete {isProvider ? "connection" : "profile"}</span>
        </button>
      </form>
    {/if}
  {/if}
</Modal>
