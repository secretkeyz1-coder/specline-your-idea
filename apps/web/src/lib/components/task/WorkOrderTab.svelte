<script lang="ts">
  import { enhance, deserialize } from "$app/forms";
  import { Check, ChevronDown, Copy } from "lucide-svelte";
  import { onDestroy } from "svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { TaskDetail } from "$lib/task-detail.js";

  /**
   * The work order hand-off: copy one of three prompts for a coding agent, or
   * record a run done elsewhere. `primary` makes the first prompt the page's
   * main action (the side rail while the task waits for an agent).
   */
  let {
    task,
    runCount,
    busy = $bindable(null),
    primary = true,
  }: { task: TaskDetail; runCount: number; busy: string | null; primary?: boolean } = $props();

  let promptMode = $state<"STANDALONE" | "CONNECTED_CLI" | "CONNECTED_MCP">("STANDALONE");
  let copied = $state(false);
  let copyError = $state<string | null>(null);
  // Which prompt is being prepared (the API builds it on request), so the
  // clicked button can say so while all three stay disabled.
  let copying = $state<"STANDALONE" | "CONNECTED_CLI" | "CONNECTED_MCP" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(copyTimer));

  const PROMPT_BUTTONS = [
    { mode: "STANDALONE" as const, label: "Copy prompt", main: true },
    { mode: "CONNECTED_CLI" as const, label: "Copy CLI prompt", main: false },
    { mode: "CONNECTED_MCP" as const, label: "Copy MCP prompt", main: false },
  ];

  async function copyPrompt(mode: "STANDALONE" | "CONNECTED_CLI" | "CONNECTED_MCP") {
    promptMode = mode;
    copyError = null;
    copied = false;
    clearTimeout(copyTimer);
    copying = mode;
    try {
      const body = new FormData();
      body.set("taskId", task.id);
      body.set("mode", mode);
      const response = await fetch(`?/prompt`, { method: "POST", body });
      const payload = deserialize(await response.text()) as { type: string; data?: { prompt?: string; message?: string } };
      const text = payload.data?.prompt ?? "";
      if (!text) {
        copyError = payload.data?.message ?? "The work order could not be generated. Try again.";
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
        copyTimer = setTimeout(() => (copied = false), 2500);
      } catch {
        copyError = "Your browser blocked clipboard access. Allow it for this site and try again.";
      }
    } catch {
      copyError = "The work order could not be generated — check your connection and try again.";
    } finally {
      copying = null;
    }
  }
</script>

<div class="flex flex-col gap-3">
  {#if primary && task.workflowStatus === "READY" && runCount === 0}
    <p class="text-[13px] leading-relaxed text-base-content/80">Paste it into your coding agent. Its evidence comes back here.</p>
  {/if}

  <!-- Prompt buttons: the clicked one shows its own progress and result. -->
  <div class="flex flex-col gap-2">
    {#each PROMPT_BUTTONS as b (b.mode)}
      {@const isBusy = copying === b.mode}
      {@const isCopied = copied && promptMode === b.mode && !copying}
      {@const isPrimary = primary && b.main}
      <button
        class="btn w-full justify-between {isPrimary ? 'btn-primary' : b.main ? 'btn-outline border-line-control' : 'btn-ghost btn-sm'}"
        type="button"
        disabled={copying !== null}
        aria-busy={isBusy}
        onclick={() => copyPrompt(b.mode)}
      >
        <span>{isBusy ? "Preparing…" : isCopied ? "Copied" : b.label}</span>
        {#if isBusy}
          <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        {:else if isCopied}
          <Check class="size-4 {isPrimary ? '' : 'text-mint'}" aria-hidden="true" />
        {:else}
          <Copy class="size-4" aria-hidden="true" />
        {/if}
      </button>
    {/each}
  </div>

  {#if copyError}
    <Notice tone="error">{copyError}</Notice>
  {/if}

  <!-- Always mounted, so the confirmation is announced when it appears. -->
  <p class="text-xs text-mint empty:hidden" role="status">{#if copied}<span class="flex items-center gap-1.5"><Check class="size-3.5 shrink-0" aria-hidden="true" />Prompt copied to the clipboard.</span>{/if}</p>

  <details class="group text-xs text-base-content/80">
    <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-medium hover:text-base-content [&::-webkit-details-marker]:hidden">
      <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
      Which prompt?
    </summary>
    <dl class="mt-1 flex flex-col gap-1.5 ps-5 leading-relaxed">
      <div><dt class="inline font-semibold text-base-content">Prompt</dt> <dd class="inline">— any agent; you record the result as a manual run.</dd></div>
      <div><dt class="inline font-semibold text-base-content">CLI</dt> <dd class="inline">— the agent reports progress and tests through <code class="font-mono">sddctl</code>.</dd></div>
      <div><dt class="inline font-semibold text-base-content">MCP</dt> <dd class="inline">— agents connected to this workspace over MCP.</dd></div>
    </dl>
  </details>

  <!-- A run done elsewhere, recorded by hand. -->
  <details class="group rounded-box border border-line bg-base-100">
    <summary class="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-3 text-xs font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
      <ChevronDown class="size-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
      Record a manual run
    </summary>
    <form
      method="post"
      action="?/manualRun"
      use:enhance={() => {
        busy = "manual";
        return async ({ update }) => {
          busy = null;
          await update();
        };
      }}
      class="flex flex-col gap-2 px-3 pb-3 text-xs"
    >
      <input type="hidden" name="taskId" value={task.id} />
      <textarea
        class="textarea textarea-sm min-h-[64px] w-full"
        name="summary"
        required
        aria-label="Manual run summary"
        placeholder="What changed, which commands ran, the outcome…"
      ></textarea>
      <input
        class="input input-sm w-full"
        type="text"
        name="commit"
        required={task.contract.verification.evidence.includes("commit")}
        aria-label="Commit SHA"
        placeholder={task.contract.verification.evidence.includes("commit") ? "Commit SHA (required)" : "Commit SHA (optional)"}
      />
      <textarea
        class="textarea textarea-sm min-h-[80px] w-full font-mono"
        name="diff"
        maxlength="120000"
        required={task.contract.verification.evidence.includes("diff")}
        aria-label="Implementation diff"
        placeholder="Paste the implementation diff when required by the task"
      ></textarea>
      {#if task.contract.verification.required.length}
        <!-- Evidence policy (C2): every required command needs a result. -->
        <fieldset class="fieldset gap-1.5 rounded-box border border-line px-2.5 pb-2.5">
          <legend class="fieldset-legend px-1 text-xs font-medium text-base-content/80">Required checks</legend>
          {#each task.contract.verification.required as check}
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <code class="truncate font-mono text-xs">{check.command}</code>
              <input type="hidden" name="test_command" value={check.command} />
              <!-- No default: "Passed" pre-selected recorded untested commands as passing. -->
              <select class="select select-sm w-28 text-xs" name="test_status" required aria-label={`Result of ${check.command}`}>
                <option value="" disabled selected>Choose…</option>
                <option value="PASSED">Passed</option>
                <option value="FAILED">Failed</option>
                <option value="SKIPPED">Not run</option>
              </select>
              {#if check.type !== "manual"}
                <input class="input input-sm w-full sm:w-28" type="number" step="1" name="test_exit_code" required aria-label={`Exit code of ${check.command}`} placeholder="Exit code" />
              {:else}
                <input type="hidden" name="test_exit_code" value="" />
              {/if}
            </div>
          {/each}
        </fieldset>
      {/if}
      <button class="btn btn-sm btn-outline border-line-control" type="submit" disabled={busy !== null}>
        {#if busy === "manual"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
        <span>Submit for review</span>
      </button>
    </form>
  </details>
</div>
