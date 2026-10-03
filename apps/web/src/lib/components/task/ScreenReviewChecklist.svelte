<script lang="ts">
  import { CircleAlert, CircleCheck, Monitor } from "lucide-svelte";
  import type { RunRow, ScreenReview } from "$lib/task-detail.js";

  /**
   * What to look at before approving a screen task: whether its render check
   * passed, and the rubric its screen is judged by — inside the shell, every
   * key element, the mockup's regions, order and copy, the design tokens.
   */
  let { review, run }: { review: ScreenReview; run: RunRow | null } = $props();

  const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
  // The latest result reported for the render check command in this run.
  const renderResult = $derived.by(() => {
    const command = review.render_check.command;
    if (!command || !run) return null;
    return [...run.tests].reverse().find((t) => same(t.command, command)) ?? null;
  });
  const renderPassed = $derived(renderResult?.status === "PASSED");
  const keyOf = (file: string) => file.replace(/^.*\//, "").replace(/\.html$/, "");
</script>

<section class="flex flex-col gap-3 rounded-box border border-line px-3.5 py-3" aria-labelledby="screen-check-title">
  <h3 id="screen-check-title" class="flex items-center gap-1.5 text-[13px] font-semibold">
    <Monitor class="size-4 text-base-content/70" aria-hidden="true" />
    Check the screen
  </h3>

  {#if !review.render_check.required}
    <p class="text-xs leading-relaxed text-base-content/80">Run it on a phone or emulator and compare it with the mockup.</p>
  {:else if !review.render_check.command}
    <p class="flex gap-2 rounded-box border border-warn/40 bg-warn-soft px-3 py-2 text-xs leading-relaxed">
      <CircleAlert class="mt-px size-4 shrink-0 text-warn" aria-hidden="true" />
      <span>No render check. Open the screen at 1280 and 360 px yourself before approving.</span>
    </p>
  {:else if renderPassed}
    <p class="flex gap-2 text-xs leading-relaxed">
      <CircleCheck class="mt-px size-4 shrink-0 text-mint" aria-hidden="true" />
      <span>
        Render check passed at 1280 and 360 px.
        {#if review.screenshots_dir}Screenshots are in <code class="font-mono">{review.screenshots_dir}/</code> in the commit.{/if}
      </span>
    </p>
  {:else}
    <p class="flex gap-2 rounded-box border border-warn/40 bg-warn-soft px-3 py-2 text-xs leading-relaxed">
      <CircleAlert class="mt-px size-4 shrink-0 text-warn" aria-hidden="true" />
      <span>The render check has no passing result in this run: <code class="font-mono break-all">{review.render_check.command}</code></span>
    </p>
  {/if}

  {#each review.screens as screen (screen.file)}
    <div class="flex flex-col gap-1.5 text-xs leading-relaxed">
      <p class="font-semibold">
        {screen.name}
        <code class="font-mono font-normal text-base-content/70">{screen.file}</code>
      </p>
      <ul class="flex list-disc flex-col gap-1 pl-4 text-base-content/85">
        <li>
          {screen.inside_shell
            ? "Inside the app shell: the shared navigation around it, no page or navigation of its own."
            : "Outside the shell: no app navigation; it leads into the app."}
        </li>
        {#if screen.key_elements.length}
          <li>
            Shows every key element:
            <ul class="mt-0.5 flex list-[circle] flex-col gap-0.5 pl-4">
              {#each screen.key_elements as element}<li>{element}</li>{/each}
            </ul>
          </li>
        {/if}
        <li>Regions, order and copy match the mockup{#if review.screenshots_dir}, at both widths (<code class="font-mono">{keyOf(screen.file)}-1280.png</code>, <code class="font-mono">-360.png</code>){/if}.</li>
        <li>Colours, fonts and spacing come from the design tokens, not hard-coded values.</li>
      </ul>
    </div>
  {/each}
</section>
