<script lang="ts">
  import { Play } from "lucide-svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { actorLabel, eventDescription } from "$lib/labels.js";
  import { STATUS_META, type WorkflowStatus } from "$lib/status.js";
  import { mapRunStatus, type RunRow, type TaskEventRow } from "$lib/task-detail.js";

  /** The runs & evidence tab: every attempt with its tests and files, then the task's recent activity. */
  let { runs, events }: { runs: RunRow[]; events: TaskEventRow[] } = $props();

  // Fixed zone + locale so server and browser render the same string.
  const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const formatTime = (iso: string) => `${timeFormat.format(new Date(iso))} UTC`;
  const statusText = (s: string) => STATUS_META[s as WorkflowStatus]?.label ?? s;

  /**
   * Who did it. Most task events carry the actor type directly; a claim made
   * with a person's token still names the executor it was made for in its
   * payload, so an agent's claim is not credited to "you or a teammate".
   */
  function eventActor(event: { actorType: string; payload: Record<string, unknown> }): string {
    if (event.actorType.toUpperCase() !== "USER") return actorLabel(event.actorType);
    const executor = event.payload?.executor as { type?: unknown } | undefined;
    if (executor && typeof executor.type === "string" && executor.type.toUpperCase() !== "USER") return actorLabel(executor.type);
    return actorLabel(event.actorType);
  }
</script>

<div>
  {#if runs.length === 0}
    <div class="flex flex-col items-center gap-1 py-6 text-center text-[13px] text-base-content/80">
      <Play class="size-5 text-base-content/75" aria-hidden="true" />
      <p>No runs yet.</p>
    </div>
  {:else}
    <ol class="flex flex-col gap-3">
      {#each runs as entry (entry.run.id)}
        <li class="rounded-box border border-line bg-base-200 p-3">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-xs font-semibold">Attempt {entry.run.attempt}</span>
            <StatusBadge status={mapRunStatus(entry.run.status)} />
            <span class="text-xs text-base-content/75">
              {actorLabel(entry.run.executorType)}
            </span>
            {#if entry.run.commitSha}
              <span class="font-mono text-xs text-base-content/80">
                · {entry.run.commitSha.slice(0, 8)}
              </span>
            {/if}
          </div>

          {#if entry.run.summary}
            <p class="mt-2 text-xs leading-relaxed text-base-content/80">
              {entry.run.summary}
            </p>
          {/if}

          {#if entry.tests.length}
            <div class="mt-2 flex flex-col gap-1 border-t border-line pt-1.5">
              {#each entry.tests as test}
                <div class="flex items-center justify-between font-mono text-xs">
                  <span class="truncate text-base-content/80">$ {test.command}</span>
                  <span
                    class="flex shrink-0 items-center gap-1.5 font-sans text-xs font-semibold {test.status === 'PASSED'
                      ? 'text-mint'
                      : test.status === 'SKIPPED'
                        ? 'text-base-content/75'
                        : 'text-danger'}"
                  >
                    <span class="size-2 rounded-full {test.status === 'PASSED' ? 'bg-mint' : test.status === 'SKIPPED' ? 'bg-line-control' : 'bg-danger'}" aria-hidden="true"></span>
                    {test.status === "SKIPPED" ? "not run" : test.status.toLowerCase()}
                  </span>
                </div>
              {/each}
            </div>
          {/if}

          {#if entry.run.filesChanged.length}
            <details class="collapse collapse-arrow mt-2 rounded-none border-t border-line pt-1.5 text-xs">
              <summary class="collapse-title min-h-0 px-0 py-1 pe-6 after:end-1 font-medium text-base-content/80 hover:text-base-content">
                {entry.run.filesChanged.length} {entry.run.filesChanged.length === 1 ? "file" : "files"} changed
              </summary>
              <ul class="collapse-content max-h-[160px] overflow-y-auto px-0 pb-0 font-mono text-base-content/80">
                {#each entry.run.filesChanged as file (file)}
                  <li class="truncate" title={file}>{file}</li>
                {/each}
              </ul>
            </details>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if events.length}
    <div class="mt-4 border-t border-line pt-3">
      <h3 class="text-[13px] font-semibold text-base-content">Activity</h3>
      <ol class="mt-2 flex flex-col gap-1.5 text-xs">
        {#each [...events].reverse().slice(0, 25) as event (event.id)}
          <li class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 text-base-content">
              {eventDescription(event.eventType, event.payload, statusText)}
              <span class="text-base-content/80">· {eventActor(event)}</span>
            </span>
            <time class="tabular-nums shrink-0 text-base-content/80" datetime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</div>
