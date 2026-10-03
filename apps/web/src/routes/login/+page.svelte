<script lang="ts">
  import { onMount } from "svelte";
  import { Building2, Check, Circle, LogIn, Moon, Sun } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";

  let { data, form }: { data: { needsBootstrap: boolean; next: string }; form: { message?: string; mode?: string } | null } = $props();
  let manualMode = $state<"login" | "bootstrap" | null>(null);
  const mode = $derived(manualMode ?? (data.needsBootstrap ? "bootstrap" : "login"));
  // Keep ?next= on the action URL too, so a failed attempt re-renders with it intact.
  const nextQuery = $derived(data.next && data.next !== "/" ? `&next=${encodeURIComponent(data.next)}` : "");

  // First-account password rules, filled in as they are met (the API enforces them).
  let password = $state("");
  const rules = $derived([
    { label: "10+ characters", met: password.length >= 10 },
    { label: "Mixed case", met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "A digit", met: /\d/.test(password) },
  ]);

  // Phones have no sidebar before sign-in, so the top bar carries the theme
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
</script>

<svelte:head>
  <title>{mode === "bootstrap" ? "Create account" : "Sign in"} — SDD Control Plane</title>
</svelte:head>

{#snippet brand()}
  <div class="flex items-center gap-2.5">
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
      <rect width="24" height="24" rx="7" fill="var(--color-primary)" />
      <path d="M6 7.5h12M6 12h7M6 16.5h9.5" stroke="var(--color-primary-content)" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="17.5" cy="12" r="2" fill="var(--color-primary-content)" />
    </svg>
    <span class="text-[16px] font-bold tracking-tight">specline<span class="text-primary-ink">youridea</span></span>
  </div>
{/snippet}

{#snippet phoneBar()}
  <!-- Phones: a slim top bar — brand and the theme button. -->
  <div class="-mx-4 -mt-8 flex h-14 items-center justify-between border-b border-line ps-4 pe-2 sm:hidden">
    {@render brand()}
    <button type="button" class="btn btn-ghost btn-square size-11" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onclick={toggleTheme}>
      {#if dark}<Sun class="size-4" aria-hidden="true" />{:else}<Moon class="size-4" aria-hidden="true" />{/if}
    </button>
  </div>
{/snippet}

{#snippet motif(widths: [string, string, string])}
  <!-- The logo's three spec lines and a proof dot, at poster scale -->
  <div aria-hidden="true" class="flex flex-col gap-5">
    <span class="block h-10 rounded-full border border-line bg-base-100 {widths[0]}"></span>
    <div class="flex items-center gap-5">
      <span class="block h-10 rounded-full border border-line bg-base-100 {widths[1]}"></span>
      <span class="block size-10 shrink-0 rounded-full bg-primary"></span>
    </div>
    <span class="block h-10 rounded-full border border-line bg-base-100 {widths[2]}"></span>
  </div>
{/snippet}

{#if mode === "bootstrap"}
  <div class="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
    <main class="flex min-w-0 flex-col px-4 py-8 sm:px-10 sm:py-10 lg:px-20">
      {@render phoneBar()}
      <div class="max-sm:hidden">{@render brand()}</div>
      <form method="post" action={`?/bootstrap${nextQuery}`} class="mt-12 flex w-full max-w-[520px] flex-col gap-8 max-sm:mt-5 max-sm:gap-6 lg:mt-24">
        <input type="hidden" name="next" value={data.next} />
        <div class="flex flex-col gap-2.5 max-sm:gap-2">
          <h1 class="font-display text-[28px] leading-[1.1] font-extrabold tracking-tight text-base-content sm:text-[32px]">
            Create the first account.
          </h1>
          <p class="text-[15px] leading-relaxed text-base-content/80 max-sm:text-[14px]">It becomes the admin of this instance.</p>
        </div>

        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-[13px] font-semibold">Email address</span>
            <input class="input h-11 w-full border-line-control text-[16px] max-sm:h-12 sm:text-[14px]" type="email" name="email" required placeholder="you@company.com" autocomplete="email" />
          </label>
          <div class="flex flex-col gap-1.5">
            <label class="text-[13px] font-semibold" for="bootstrap-password">Password</label>
            <input
              id="bootstrap-password"
              class="input h-11 w-full border-line-control text-[16px] max-sm:h-12 sm:text-[14px]"
              type="password"
              name="password"
              required
              minlength="10"
              placeholder="10+ chars, mixed case + digit"
              autocomplete="new-password"
              aria-describedby="pw-rules"
              bind:value={password}
            />
            <ul id="pw-rules" class="mt-1.5 grid grid-cols-3 gap-2.5" aria-label="Password rules">
              {#each rules as rule (rule.label)}
                <li class="flex flex-col gap-1.5">
                  <span class="block h-1.5 rounded-full border {rule.met ? 'border-primary bg-primary' : 'border-line bg-base-300'}" aria-hidden="true"></span>
                  <span class="inline-flex items-center gap-1.5 text-xs {rule.met ? 'text-base-content' : 'text-base-content/75'}">
                    {#if rule.met}<Check class="size-3 shrink-0 text-mint" strokeWidth={3} aria-hidden="true" />{:else}<Circle class="size-3 shrink-0" aria-hidden="true" />{/if}
                    {rule.label}<span class="sr-only">{rule.met ? "(met)" : "(not yet)"}</span>
                  </span>
                </li>
              {/each}
            </ul>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-[13px] font-semibold">Workspace name</span>
            <input class="input h-11 w-full border-line-control text-[16px] max-sm:h-12 sm:text-[14px]" type="text" name="workspace" placeholder="Default Workspace" />
          </label>
        </div>

        {#if form?.message && form.mode === "bootstrap"}
          <Notice tone="error">{form.message}</Notice>
        {/if}

        <button class="btn btn-primary btn-lg self-start max-sm:w-full max-sm:self-stretch" type="submit">
          <Building2 class="size-4" aria-hidden="true" />
          Create account
        </button>
      </form>
    </main>

    <aside class="hidden flex-col justify-center border-l border-line bg-base-300 px-16 py-10 lg:flex">
      {@render motif(["w-full", "w-[58%]", "w-[79%]"])}
    </aside>
  </div>
{:else}
  <div class="grid min-h-screen lg:grid-cols-[minmax(0,780px)_minmax(0,1fr)]">
    <section class="hidden flex-col border-r border-line bg-base-300 px-16 py-10 lg:flex xl:px-[72px]">
      {@render brand()}
      <div class="mt-24">{@render motif(["w-[440px] max-w-full", "w-[256px]", "w-[348px] max-w-full"])}</div>
      <div class="grow"></div>
      <p class="max-w-[14ch] font-display text-[44px] leading-[1.08] font-extrabold tracking-tight text-base-content">
        Plan the work. Hand it off. Review the <span class="text-primary-ink">proof</span>.
      </p>
    </section>

    <main class="flex min-w-0 flex-col px-4 py-8 sm:px-10 sm:py-10 lg:px-[72px]">
      {@render phoneBar()}
      <div class="lg:hidden max-sm:hidden">{@render brand()}</div>
      <div class="flex grow flex-col justify-center py-10 max-sm:justify-start max-sm:pt-5 max-sm:pb-0">
        <form method="post" action={`?/login${nextQuery}`} class="mx-auto flex w-full max-w-[400px] flex-col gap-7 max-sm:gap-6">
          <input type="hidden" name="next" value={data.next} />
          <h1 class="font-display text-[28px] leading-tight font-extrabold tracking-tight text-base-content sm:text-[32px]">Sign in</h1>

          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[13px] font-semibold">Email address</span>
              <input class="input h-11 w-full border-line-control text-[16px] max-sm:h-12 sm:text-[14px]" type="email" name="email" required placeholder="you@company.com" autocomplete="email" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[13px] font-semibold">Password</span>
              <input class="input h-11 w-full border-line-control text-[16px] max-sm:h-12 sm:text-[14px]" type="password" name="password" required autocomplete="current-password" />
            </label>
          </div>

          {#if form?.message && form.mode === "login"}
            <Notice tone="error">{form.message}</Notice>
          {/if}

          <button class="btn btn-primary btn-lg w-full" type="submit">
            <LogIn class="size-4" aria-hidden="true" />
            Sign in
          </button>
        </form>
      </div>
    </main>
  </div>
{/if}
