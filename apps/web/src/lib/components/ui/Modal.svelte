<script lang="ts">
  // daisyUI modal on the native <dialog>: showModal() gives the top layer,
  // an inert page behind, Esc to close and focus returned on close.
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    onclose,
    dismissible = true,
    labelledby,
    describedby,
    class: className = "",
    boxClass = "",
    sheetOnPhone = false,
    children,
  }: {
    open?: boolean;
    /** Called after the dialog closed itself (Esc, backdrop, a method="dialog" form). */
    onclose?: () => void;
    /** false: Esc and the backdrop do nothing (a request is running). */
    dismissible?: boolean;
    labelledby?: string;
    describedby?: string;
    class?: string;
    boxClass?: string;
    /** Phones (< 640px): the box becomes a bottom sheet with a grab handle. From sm up nothing changes. */
    sheetOnPhone?: boolean;
    children: Snippet;
  } = $props();

  // The bottom sheet: full width, square bottom corners, only a top hairline,
  // 16px sides and room for the home indicator. Utilities, so sm+ is untouched.
  const SHEET =
    "max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-3rem)] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:border-t max-sm:border-line max-sm:px-4 max-sm:pt-5 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]";

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function handleClose() {
    if (!open) return;
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="modal {sheetOnPhone ? 'max-sm:place-items-end' : ''} {className}"
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  onclose={handleClose}
  oncancel={(e) => { if (!dismissible) e.preventDefault(); }}
>
  {#if open}
    <div class="modal-box {boxClass} {sheetOnPhone ? SHEET : ''}">
      {#if sheetOnPhone}<span class="mx-auto mb-1 block h-1 w-10 shrink-0 rounded-full bg-line-control sm:hidden" aria-hidden="true"></span>{/if}
      {@render children()}
    </div>
    {#if dismissible}
      <form method="dialog" class="modal-backdrop">
        <button tabindex="-1" aria-hidden="true">close</button>
      </form>
    {/if}
  {/if}
</dialog>
