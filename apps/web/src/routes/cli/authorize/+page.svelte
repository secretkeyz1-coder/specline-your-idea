<script lang="ts">
  import { enhance } from "$app/forms";
  import Notice from "$lib/components/Notice.svelte";
  import { Check, ChevronDown, LogIn, ShieldCheck } from "lucide-svelte";

  let {
    data,
    form,
  }: {
    data: { code: string; authenticated: boolean };
    form: { ok?: boolean; notice?: string; message?: string; code?: string } | null;
  } = $props();

  const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  function normalizeCode(raw: string): string {
    const compact = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    return /^[A-Z0-9]{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
  }

  // A code arrives in the link `sddctl login` opens; without one the user types it.
  let typed = $state("");
  let busy = $state<"approve" | "deny" | null>(null);
  const fromLink = $derived(Boolean(data.code));
  const code = $derived(fromLink ? data.code : normalizeCode(typed || form?.code || ""));
  const codeValid = $derived(CODE_PATTERN.test(code));

  const signInHref = $derived(
    `/login?next=${encodeURIComponent(data.code ? `/cli/authorize?code=${data.code}` : "/cli/authorize")}`,
  );

  const PERMISSIONS = ["Read projects and tasks", "Run work orders", "Submit results", "Report bugs", "Register this machine"];
</script>

<svelte:head>
  <title>Authorize CLI — SDD Control Plane</title>
</svelte:head>

{#snippet codeTiles(value: string)}
  <div class="flex items-center gap-1 font-mono max-sm:justify-center sm:gap-1.5" role="img" aria-label={`Code ${value.split("").join(" ")}`}>
    {#each value.split("") as ch, i (i)}
      {#if ch === "-"}
        <span class="mx-1 block h-1 w-3 rounded-full bg-primary sm:mx-2 sm:w-4" aria-hidden="true"></span>
      {:else}
        <span class="grid h-12 w-8 place-items-center rounded-box border border-line bg-base-200 text-[22px] font-medium text-base-content max-sm:h-13 max-sm:w-[33px] max-sm:text-[24px] sm:h-[72px] sm:w-[50px] sm:text-[32px]" aria-hidden="true">{ch}</span>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="flex min-h-screen flex-col">
  {#if !data.authenticated}
    <header class="flex h-[72px] shrink-0 items-center border-b border-line px-4 max-sm:h-14 sm:px-12">
      <a href="/" class="flex items-center gap-2.5" aria-label="speclineyouridea — start">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
          <rect width="24" height="24" rx="7" fill="var(--color-primary)" />
          <path d="M6 7.5h12M6 12h7M6 16.5h9.5" stroke="var(--color-primary-content)" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="17.5" cy="12" r="2" fill="var(--color-primary-content)" />
        </svg>
        <span class="text-[15px] font-bold tracking-tight">specline<span class="text-primary-ink">youridea</span></span>
      </a>
    </header>
  {/if}

  <main class="flex grow flex-col items-center justify-center px-4 py-10 max-sm:justify-start max-sm:pt-6 max-sm:pb-8 sm:px-12 sm:pb-28">
    <div class="flex w-full max-w-[560px] flex-col gap-8 max-sm:gap-6 sm:gap-10">
      {#if !data.authenticated}
        <div class="flex flex-col gap-3 max-sm:gap-2">
          <h1 class="font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-base-content sm:text-[32px]">
            Sign in to authorize the CLI
          </h1>
          <p class="text-[15px] text-base-content/80 max-sm:text-[14px]">You'll come straight back here{data.code ? " with the same code" : ""}.</p>
        </div>
        <section class="flex flex-col gap-7 rounded-box border border-line bg-base-100 p-5 sm:p-8">
          {#if data.code}{@render codeTiles(data.code)}{/if}
          <a class="btn btn-primary btn-lg w-full" href={signInHref}>
            <LogIn class="size-4" aria-hidden="true" />
            Sign in to continue
          </a>
        </section>
      {:else if form?.ok}
        <h1 class="font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-base-content sm:text-[32px]">
          Back to your terminal
        </h1>
        <Notice tone="success">{form.notice}</Notice>
      {:else}
        <div class="flex flex-col gap-3 max-sm:gap-2">
          <h1 class="font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-base-content sm:text-[32px]">
            {#if fromLink}
              Does this code match your terminal?
            {:else}
              Enter the code from your terminal
            {/if}
          </h1>
          <p class="text-[15px] text-base-content/80 max-sm:text-[14px]">
            {fromLink ? "Approve only if you just ran" : "Run"} <kbd class="kbd kbd-sm font-mono text-[13px]">sddctl login</kbd>{fromLink ? "." : " to get one."}
          </p>
        </div>

        <form
          method="post"
          action="?/approve"
          class="flex flex-col gap-7 rounded-box border border-line bg-base-100 p-5 max-sm:gap-5 sm:p-8"
          aria-label="Code from your terminal"
          use:enhance={({ submitter }) => {
            busy = submitter?.getAttribute("formaction")?.includes("deny") ? "deny" : "approve";
            return async ({ update }) => {
              await update({ reset: false });
              busy = null;
            };
          }}
        >
          {#if fromLink}
            <input type="hidden" name="code" value={data.code} />
            {@render codeTiles(data.code)}
          {:else}
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold" for="cli-code">Code</label>
              <input
                id="cli-code"
                class="input h-14 w-full border-line-control text-center font-mono text-[24px] tracking-[0.18em] uppercase"
                name="code"
                bind:value={typed}
                placeholder="XXXX-XXXX"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                maxlength={9}
                aria-describedby="cli-code-hint"
                required
              />
              <p id="cli-code-hint" class="text-xs text-base-content/75">Eight letters and numbers, like ABCD-2345.</p>
            </div>
          {/if}

          <details class="group text-[13px]">
            <summary class="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 font-semibold text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
              Permissions<ChevronDown class="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ul class="mt-2 grid gap-x-4 gap-y-2.5 max-sm:mt-1 max-sm:gap-y-1.5 sm:grid-cols-2">
              {#each PERMISSIONS as perm (perm)}
                <li class="flex items-center gap-2"><Check class="size-4 shrink-0 text-primary-ink" aria-hidden="true" />{perm}</li>
              {/each}
            </ul>
          </details>

          {#if form?.message}
            <Notice tone="error">{form.message}</Notice>
          {/if}

          <!-- Authorize comes first in the DOM so Enter approves, never denies. -->
          <div class="flex flex-col gap-3 border-t border-line pt-6 max-sm:gap-2 max-sm:pt-5 sm:flex-row-reverse sm:items-center sm:justify-between">
            <button class="btn btn-primary btn-lg" type="submit" disabled={!codeValid || busy !== null}>
              {#if busy === "approve"}
                <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
              {:else}
                <ShieldCheck class="size-4" aria-hidden="true" />
              {/if}
              Authorize CLI
            </button>
            <button class="btn btn-ghost btn-lg" type="submit" formaction="?/deny" disabled={!codeValid || busy !== null}>
              {#if busy === "deny"}
                <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
              {/if}
              Deny access
            </button>
          </div>
        </form>
      {/if}
    </div>
  </main>
</div>
