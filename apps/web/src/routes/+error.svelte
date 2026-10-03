<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { ArrowLeft, House, LogIn, Moon, RefreshCw, Sun } from "lucide-svelte";

  // SvelteKit does not pass status/error as props to +error.svelte; they live on `page`.
  const status = $derived(page.status);
  const kind = $derived(
    status === 404 ? "not-found" : status === 401 || status === 403 ? "no-access" : "server",
  );
  const signedIn = $derived(Boolean((page.data as { user?: unknown }).user));

  const heading = $derived(
    kind === "not-found"
      ? "Page not found"
      : kind === "no-access"
        ? "You don't have access"
        : "Something went wrong on our side",
  );

  // The server's own message is shown only when it adds something — the
  // framework's generic "Not Found" / "Internal Error" strings do not.
  const serverMessage = $derived.by(() => {
    const message = page.error?.message?.trim() ?? "";
    return ["", "Not Found", "Internal Error", "Forbidden", "Unauthorized"].includes(message) ? "" : message;
  });

  const detail = $derived(
    kind === "not-found"
      ? "The link may be wrong, or the page was removed."
      : kind === "no-access"
        ? "Sign in with an account that belongs to this workspace or project."
        : "The request could not be completed. Try again in a moment.",
  );

  // Signed out on a phone there is no sidebar, so the top bar carries the theme
  // button (same behaviour as the sidebar's: pins the theme and remembers it).
  let dark = $state(true);
  onMount(() => {
    dark = document.documentElement.dataset.theme !== "forest-light";
  });
  function toggleTheme() {
    dark = !dark;
    const theme = dark ? "forest" : "forest-light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("sdd-theme", theme);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  const signInHref = $derived(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`);
</script>

<svelte:head>
  <title>{heading} — SDD Control Plane</title>
</svelte:head>

<!-- Signed in, phones already have the app's 56px top bar above this. -->
<div class="flex min-h-screen flex-col {signedIn ? 'max-sm:min-h-[calc(100dvh-3.5rem)]' : ''}">
  {#if !signedIn}
    <header class="flex h-[72px] shrink-0 items-center px-4 max-sm:h-14 max-sm:justify-between max-sm:border-b max-sm:border-line max-sm:pe-2 sm:px-12">
      <a href="/" class="flex items-center gap-2.5" aria-label="speclineyouridea — start">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
          <rect width="24" height="24" rx="7" fill="var(--color-primary)" />
          <path d="M6 7.5h12M6 12h7M6 16.5h9.5" stroke="var(--color-primary-content)" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="17.5" cy="12" r="2" fill="var(--color-primary-content)" />
        </svg>
        <span class="text-[15px] font-bold tracking-tight">specline<span class="text-primary-ink">youridea</span></span>
      </a>
      <button type="button" class="btn btn-ghost btn-square size-11 sm:hidden" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onclick={toggleTheme}>
        {#if dark}<Sun class="size-4" aria-hidden="true" />{:else}<Moon class="size-4" aria-hidden="true" />{/if}
      </button>
    </header>
  {/if}

  <main class="grid grow content-center justify-center gap-10 px-4 py-12 max-sm:flex max-sm:flex-col max-sm:gap-6 max-sm:pt-5 max-sm:pb-8 sm:px-12 lg:grid-cols-[minmax(0,480px)_minmax(0,480px)] lg:gap-16 lg:pb-[72px] xl:gap-24">
    <!-- Empty-state art: the logo's spec lines, with the proof dot missing -->
    <div aria-hidden="true" class="hidden h-[360px] flex-col justify-center gap-6 rounded-box border border-line bg-base-100 p-12 max-sm:flex max-sm:h-auto max-sm:gap-4 max-sm:p-6 md:flex">
      <div class="flex items-center gap-4">
        <span class="font-mono text-[13px] font-medium text-base-content/80">{status}</span>
        <span class="h-px grow bg-line"></span>
      </div>
      <span class="block h-9 w-full rounded-full border border-line bg-base-300 max-sm:h-6"></span>
      <div class="flex items-center gap-3.5 max-sm:gap-2.5">
        <span class="block h-9 w-[46%] rounded-full border border-line bg-base-300 max-sm:h-6"></span>
        <span class="block size-3.5 rounded-full bg-line-control max-sm:size-2.5"></span>
        <span class="block size-2 rounded-full bg-line-control max-sm:size-1.5"></span>
        <span class="grow"></span>
        <span class="block size-9 rounded-full border-2 border-dashed border-primary max-sm:size-6"></span>
      </div>
      <span class="block h-9 w-[72%] rounded-full border border-line bg-base-300 max-sm:h-6"></span>
    </div>

    <div class="flex max-w-[520px] flex-col justify-center gap-7 max-sm:grow max-sm:justify-start">
      <div class="flex flex-col gap-3 max-sm:gap-2">
        <h1 class="font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-base-content sm:text-[32px]">
          {#if kind === "not-found"}
            This page isn't here.
          {:else if kind === "no-access"}
            You don't have access.
          {:else}
            Something went wrong.
          {/if}
        </h1>
        <p class="max-w-[40ch] text-[16px] leading-relaxed text-base-content/80 max-sm:text-[14px]">{detail}</p>
        {#if serverMessage && kind !== "not-found"}
          <p class="max-w-[48ch] text-[13px] text-base-content/75">{serverMessage}</p>
        {/if}
        {#if kind === "server"}
          <p class="text-xs text-base-content/75">Error code <span class="font-mono">{status}</span></p>
        {/if}
      </div>

      <!-- Phones: the actions stack at the bottom, the primary last, in thumb reach. -->
      <div class="flex flex-wrap items-center gap-3 max-sm:mt-auto max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
        <button class="btn btn-ghost btn-lg" type="button" onclick={() => history.back()}>
          <ArrowLeft class="size-4" aria-hidden="true" />
          Go back
        </button>
        {#if kind === "no-access"}
          <a class="btn btn-outline btn-lg border-line-control" href="/">
            <House class="size-4" aria-hidden="true" />
            Back to start
          </a>
          <a class="btn btn-primary btn-lg" href={signInHref}>
            <LogIn class="size-4" aria-hidden="true" />
            Sign in
          </a>
        {:else if kind === "server"}
          <a class="btn btn-outline btn-lg border-line-control" href="/">
            <House class="size-4" aria-hidden="true" />
            Back to start
          </a>
          <button class="btn btn-primary btn-lg" type="button" onclick={() => location.reload()}>
            <RefreshCw class="size-4" aria-hidden="true" />
            Try again
          </button>
        {:else}
          <a class="btn btn-primary btn-lg" href="/">
            <House class="size-4" aria-hidden="true" />
            Back to start
          </a>
        {/if}
      </div>
    </div>
  </main>
</div>
