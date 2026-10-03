<script lang="ts">
  import { enhance } from "$app/forms";
  import { Bug as BugIcon, Check, CircleCheck, RotateCcw } from "lucide-svelte";
  import { reviewPolicyLabel } from "$lib/labels.js";
  import type { ReviewRow, RunRow, ScreenReview, TaskDetail } from "$lib/task-detail.js";
  import ScreenReviewChecklist from "./ScreenReviewChecklist.svelte";

  /** What the task's state asks of a person: review the evidence, requeue rework, unblock or cancel — or nothing, once done. */
  let {
    task,
    runs,
    reviews,
    screenReview = null,
    busy = $bindable(null),
  }: { task: TaskDetail; runs: RunRow[]; reviews: ReviewRow[]; screenReview?: ScreenReview | null; busy: string | null } = $props();

  // The latest submitted attempt is what a reviewer is deciding on.
  const reviewRun = $derived(runs.find((r) => r.run.status === "SUBMITTED") ?? runs[0] ?? null);

  // The review's secondary answers open in place, one at a time.
  let openForm = $state<"changes" | "bug" | null>(null);
  const toggle = (f: "changes" | "bug") => (openForm = openForm === f ? null : f);
</script>

{#if task.workflowStatus === "NEEDS_REVIEW"}
  <section class="card flex flex-col gap-3.5 border border-primary-ink bg-base-100 p-5 max-sm:px-4 sm:p-6" aria-labelledby="decision-title">
    <div>
      <h2 id="decision-title" class="text-[16px] font-semibold">Your decision</h2>
      <p class="mt-0.5 text-xs text-base-content/75">{reviewPolicyLabel(task.reviewPolicy)}</p>
    </div>

    {#if screenReview}<ScreenReviewChecklist review={screenReview} run={reviewRun} />{/if}

    <form
      method="post"
      action="?/review"
      use:enhance={() => {
        busy = "approve";
        return async ({ update }) => {
          busy = null;
          await update();
        };
      }}
    >
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="decision" value="APPROVED" />
      <button class="btn btn-primary btn-lg w-full" type="submit" disabled={busy !== null || !reviewRun}>
        {#if busy === "approve"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Check class="size-4" aria-hidden="true" />{/if}
        <span>Approve work order</span>
      </button>
      {#if !reviewRun}<p class="mt-1.5 text-xs text-base-content/75">No run to approve yet.</p>{/if}
    </form>

    <div class="flex gap-2">
      <button
        type="button"
        class="btn flex-1 border-danger/40 bg-transparent px-3 text-[13px] whitespace-nowrap text-danger hover:bg-danger-soft"
        aria-expanded={openForm === "changes"}
        aria-controls="request-changes-form"
        onclick={() => toggle("changes")}
      >
        Request changes
      </button>
      <button
        type="button"
        class="btn btn-ghost px-3 text-[13px] whitespace-nowrap"
        aria-expanded={openForm === "bug"}
        aria-controls="report-bug-form"
        onclick={() => toggle("bug")}
      >
        <BugIcon class="size-4" aria-hidden="true" />
        Report bug
      </button>
    </div>

    {#if openForm === "changes"}
      <form
        id="request-changes-form"
        method="post"
        action="?/review"
        use:enhance={() => {
          busy = "changes";
          return async ({ update }) => {
            busy = null;
            await update();
          };
        }}
        class="flex flex-col gap-2"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="decision" value="CHANGES_REQUESTED" />
        <textarea
          class="textarea min-h-[80px] w-full text-[13px]"
          name="findings"
          required
          aria-label="What needs to change"
          placeholder="What needs to change, and why…"
        ></textarea>
        <button class="btn btn-sm btn-outline border-line-control self-end" type="submit" disabled={busy !== null}>
          {#if busy === "changes"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          Send request
        </button>
      </form>
    {:else if openForm === "bug"}
      <!-- A bug pre-linked to this task. -->
      <form
        id="report-bug-form"
        method="post"
        action="?/createBug"
        use:enhance={() => {
          busy = "bug";
          return async ({ update }) => {
            busy = null;
            await update();
          };
        }}
        class="flex flex-col gap-2.5"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <label class="flex flex-col gap-1 text-[13px] font-semibold">
          Title
          <input class="input input-sm w-full font-normal" type="text" name="title" maxlength="200" required />
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold">
          Severity
          <select class="select select-sm w-full font-normal" name="severity">
            <option value="MAJOR">Major</option>
            <option value="BLOCKER">Blocker</option>
            <option value="CRITICAL">Critical</option>
            <option value="MINOR">Minor</option>
            <option value="TRIVIAL">Trivial</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold">
          What happens
          <textarea class="textarea textarea-sm min-h-[48px] w-full font-normal" name="current_behavior" required></textarea>
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold">
          Expected
          <textarea class="textarea textarea-sm min-h-[48px] w-full font-normal" name="expected_behavior" required></textarea>
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold">
          Steps to reproduce
          <textarea class="textarea textarea-sm min-h-[48px] w-full font-mono font-normal" name="reproduction" required></textarea>
        </label>
        <button class="btn btn-sm btn-outline border-line-control self-end" type="submit" disabled={busy !== null}>
          {#if busy === "bug"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          Report bug
        </button>
      </form>
    {/if}
  </section>
{:else if task.workflowStatus === "CHANGES_REQUESTED"}
  <section class="card flex flex-col gap-3.5 border border-line bg-base-100 p-5 max-sm:px-4 sm:p-6" aria-labelledby="decision-title">
    <h2 id="decision-title" class="text-[16px] font-semibold">Rework requested</h2>
    {#each reviews.filter((r) => r.decision === "CHANGES_REQUESTED").slice(0, 1) as review}
      <p class="rounded-box border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed">
        {review.findings.map((f) => f.message).join(" · ") || review.summary}
      </p>
    {/each}
    <form
      method="post"
      action="?/requeue"
      use:enhance={() => {
        busy = "requeue";
        return async ({ update }) => {
          busy = null;
          await update();
        };
      }}
    >
      <input type="hidden" name="taskId" value={task.id} />
      <button class="btn btn-primary w-full" type="submit" disabled={busy !== null} title="An agent can then claim a new attempt.">
        {#if busy === "requeue"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<RotateCcw class="size-4" aria-hidden="true" />{/if}
        Requeue task
      </button>
    </form>
  </section>
{:else if task.workflowStatus === "BLOCKED"}
  <section class="card flex flex-col gap-3.5 border border-danger/40 bg-base-100 p-5 max-sm:px-4 sm:p-6" aria-labelledby="decision-title">
    <h2 id="decision-title" class="text-[16px] font-semibold">Blocked</h2>
    <form
      method="post"
      action="?/unblock"
      use:enhance={() => {
        busy = "unblock";
        return async ({ update }) => {
          busy = null;
          await update();
        };
      }}
      class="flex flex-col gap-2"
    >
      <input type="hidden" name="taskId" value={task.id} />
      <input class="input input-sm w-full" type="text" name="note" aria-label="Unblock note (optional)" placeholder="What changed? (optional)" />
      <div class="flex gap-2">
        <button
          class="btn btn-primary flex-1"
          type="submit"
          name="mode"
          value="ready"
          disabled={busy !== null}
          title="Abandon the blocked attempt and return the task to the queue."
        >
          {#if busy === "unblock"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          Requeue
        </button>
        <button
          class="btn btn-outline border-line-control flex-1"
          type="submit"
          name="mode"
          value="resume"
          disabled={busy !== null}
          title="Let the same executor continue its run."
        >
          Resume run
        </button>
      </div>
    </form>
    <details class="group rounded-box border border-line">
      <summary class="flex min-h-10 cursor-pointer list-none items-center px-3 text-xs font-medium text-base-content/80 hover:text-base-content [&::-webkit-details-marker]:hidden">
        Cancel this task
      </summary>
      <form
        method="post"
        action="?/cancel"
        use:enhance={() => {
          busy = "cancel";
          return async ({ update }) => {
            busy = null;
            await update();
          };
        }}
        class="flex flex-col gap-2 px-3 pb-3"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <input class="input input-sm w-full" type="text" name="reason" required aria-label="Cancellation reason" placeholder="Why is it no longer needed?" />
        <button class="btn btn-sm btn-ghost text-danger" type="submit" disabled={busy !== null} aria-busy={busy === "cancel"}>
          {#if busy === "cancel"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          <span>{busy === "cancel" ? "Cancelling…" : "Cancel task"}</span>
        </button>
      </form>
    </details>
  </section>
{:else if task.workflowStatus === "DONE"}
  <section class="card flex flex-col items-start gap-2 border border-mint/40 bg-mint-soft p-5 max-sm:px-4 sm:p-6" aria-labelledby="decision-title">
    <CircleCheck class="size-6 text-mint" aria-hidden="true" />
    <h2 id="decision-title" class="text-[16px] font-semibold">Done and approved</h2>
    <p class="text-xs text-base-content/80">{reviews.length} review {reviews.length === 1 ? "decision" : "decisions"} recorded</p>
  </section>
{/if}
