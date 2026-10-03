<script lang="ts">
  import { enhance } from "$app/forms";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { X } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { baseUrlOriginChanged } from "$lib/origin.js";

  /** Edit a provider connection: name, base URL (a new host needs a new key), key, timeout. */
  let {
    connection = $bindable(null),
    busy = $bindable(null),
    message,
  }: { connection: Record<string, unknown> | null; busy: string | null; message?: string } = $props();

  // The base URL as typed: moving it to another host makes a new key
  // mandatory, because the stored key is not sent to a new host.
  let editBaseUrl = $state("");
  $effect(() => {
    editBaseUrl = String(connection?.base_url ?? "");
  });
  const editKeyRequired = $derived(
    connection !== null &&
      connection.provider_type !== "LOCAL_CLI" &&
      Boolean(connection.has_credential) &&
      baseUrlOriginChanged(String(connection.base_url ?? ""), editBaseUrl),
  );
</script>

<Modal sheetOnPhone open={connection !== null} onclose={() => (connection = null)} labelledby="edit-connection-title" describedby="edit-connection-desc" boxClass="flex max-h-[85vh] max-w-[500px] flex-col overflow-y-auto rounded-box border border-line p-5 sm:p-7">
  {#if connection}
    {@const cid = String(connection.id)}
    {@const isCli = connection.provider_type === "LOCAL_CLI"}
    <div class="flex items-center justify-between">
      <h2 id="edit-connection-title" class="text-[20px] font-bold tracking-tight text-base-content">Edit connection</h2>
      <button type="button" onclick={() => (connection = null)} class="btn btn-sm btn-ghost btn-square text-base-content/80 hover:text-base-content" aria-label="Close">
        <X class="size-4" />
      </button>
    </div>
    <p id="edit-connection-desc" class="mt-1 text-[13px] text-base-content/80">
      {String(connection.provider_type).toLowerCase().replaceAll("_", "-")} · the type can't change.
    </p>

    <form
      method="post"
      action="?/updateProvider"
      use:enhance={() => {
        busy = `edit-${cid}`;
        return async ({ result, update }) => {
          busy = null;
          if (result.type === "success") connection = null;
          await update();
        };
      }}
      class="mt-5 flex flex-col gap-4 text-[13px]"
    >
      <input type="hidden" name="providerId" value={cid} />
      <input type="hidden" name="provider_type" value={String(connection.provider_type)} />

      <div>
        <label class="mb-1.5 block text-xs font-medium text-base-content/80" for="edit-name">Name</label>
        <input id="edit-name" class="input w-full" name="name" required maxlength="120" value={String(connection.name)} />
      </div>

      {#if isCli}
        <div>
          <p class="mb-1.5 block text-xs font-medium text-base-content/80">Runs on</p>
          <p class="font-mono text-xs text-base-content">{String(connection.base_url)}</p>
          <p class="mt-1 text-xs text-base-content/80">To run the CLI somewhere else, add a new connection.</p>
        </div>
      {:else}
        <input type="hidden" name="original_base_url" value={String(connection.base_url ?? "")} />
        <input type="hidden" name="had_credential" value={connection.has_credential ? "1" : "0"} />
        <div>
          <label class="mb-1.5 block text-xs font-medium text-base-content/80" for="edit-base-url">Base URL</label>
          <input id="edit-base-url" class="input w-full font-mono" name="base_url" type="url" bind:value={editBaseUrl} placeholder="https://api.example.com/v1" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-base-content/80" for="edit-key">{editKeyRequired ? "API key for the new host" : "New API key"}</label>
          <input
            id="edit-key"
            class="input w-full font-mono"
            name="credential"
            type="password"
            autocomplete="off"
            required={editKeyRequired}
            aria-describedby="edit-key-hint"
            placeholder={editKeyRequired ? "Required for the new host" : connection.has_credential ? "Leave blank to keep the stored key" : "No key stored"}
          />
          <p id="edit-key-hint" class="mt-1 text-xs {editKeyRequired ? 'text-warn' : 'text-base-content/80'}">
            {#if editKeyRequired}
              The base URL now points to another host, and the stored key is not sent to a new host. Enter the key for it.
            {:else}
              The stored key is never shown. A new one replaces it and resets the last test result.
            {/if}
          </p>
        </div>
      {/if}

      <div>
        <label class="mb-1.5 block text-xs font-medium text-base-content/80" for="edit-timeout">Timeout (seconds)</label>
        <input
          id="edit-timeout"
          class="input w-32 tabular-nums"
          name="timeout_seconds"
          type="number"
          min="1"
          max="1800"
          value={Math.round(Number(connection.timeout_ms ?? 240000) / 1000)}
        />
        <p class="mt-1 text-xs text-base-content/80">
          {isCli ? "The whole CLI run." : "The longest wait for the provider to start or continue answering."} A full technical design can take several minutes on slower models.
        </p>
      </div>

      {#if message}
        <Notice tone="error">{message}</Notice>
      {/if}

      <div class="flex items-center justify-end gap-2 border-t border-line pt-4 max-sm:flex-col-reverse max-sm:items-stretch">
        <button type="button" class="btn btn-ghost" onclick={() => (connection = null)}>Cancel</button>
        <button class="btn btn-primary max-sm:btn-lg" type="submit" disabled={busy !== null}>
          {#if busy === `edit-${cid}`}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          <span>Save connection</span>
        </button>
      </div>
    </form>
  {/if}
</Modal>
