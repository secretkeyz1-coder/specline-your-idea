<script lang="ts">
  import { ArrowUpLeft, Check, Eraser, History, CircleAlert, CircleCheck, ScanSearch, Link2, MessageSquarePlus, Pencil, RefreshCw, RotateCcw, Sparkles, Trash2, Undo2, X } from "lucide-svelte";
  import Notice from "$lib/components/Notice.svelte";
  import type { LayoutReference, UxComment, UxScreen, UxVisualReview } from "$lib/types.js";
  import VisualReview from "./VisualReview.svelte";
  import type { ElementInfo } from "$lib/ux-canvas.js";
  import { blocksApproval, layoutStale } from "$lib/ux.js";

  /**
   * The right-hand panel of the canvas. With an element selected it says what
   * the element is — the kit role and the component it becomes in the chosen
   * library — and offers the edits: text in place, a link to another screen, a
   * comment. With only an artboard selected it shows the screen: its plan,
   * lint findings, comments and history, and the AI redraw.
   */
  let {
    editing,
    screen,
    boardLabel,
    info,
    libraryName,
    components,
    screens,
    busy,
    error,
    onEditText,
    onLink,
    onComment,
    onCommentUpdate,
    onFocusComment,
    onSelectParent,
    onUndo,
    onRestore,
    onCheck,
    onAiEdit,
    onRedraw,
    onDraw,
    onClear,
    onRemove,
    projectLayout = null,
    onLayout,
    onReview,
  }: {
    editing: boolean;
    screen: UxScreen | null;
    boardLabel: string;
    info: ElementInfo | null;
    libraryName: string | null;
    components: Record<string, string>;
    screens: Array<{ key: string; name: string }>;
    busy: string | null;
    error: string | null;
    onEditText: () => void;
    onLink: (target: string | null) => void;
    onComment: (text: string) => void;
    onCommentUpdate: (comment: UxComment, action: "resolve" | "reopen" | "delete") => void;
    onFocusComment: (comment: UxComment) => void;
    onSelectParent: () => void;
    onUndo: () => void;
    /** Put history entry `index` back; the current version goes onto the history. */
    onRestore: (index: number) => void;
    /** Check the drawn screen again (HTML lint and render check at phone and desktop width), no AI call. */
    onCheck: () => void;
    /** Change the selected element with AI (only that part of the screen is redrawn). */
    onAiEdit: (instruction: string) => Promise<boolean>;
    onRedraw: (instruction: string) => void;
    onDraw: () => void;
    /** Clear the drawing and keep the screen's plan, to draw it again (the drawing stays on the history). */
    onClear: () => void;
    onRemove: () => void;
    /** The layout reference every screen follows unless it has its own. */
    projectLayout?: LayoutReference | null;
    /** Set, replace or remove this screen's own layout reference. */
    onLayout?: () => void;
    /** Save the person's visual review of the drawing (aturan.md §5.6). */
    onReview?: (aspects: UxVisualReview["aspects"]) => Promise<boolean>;
  } = $props();

  // The last AI drawing, in one quiet line: model · output tokens / limit · time · repaired (aturan.md §5.7).
  const generation = $derived(screen?.generation ?? null);
  const tokens = new Intl.NumberFormat("en-GB");
  const generationLine = $derived.by(() => {
    const g = generation;
    if (!g) return "";
    const parts = [g.model ?? g.profile ?? "AI"];
    if (g.output_tokens !== null) parts.push(`${tokens.format(g.output_tokens)}${g.max_output_tokens !== null ? ` / ${tokens.format(g.max_output_tokens)}` : ""} output tokens`);
    else if (g.max_output_tokens !== null) parts.push(`limit ${tokens.format(g.max_output_tokens)} tokens`);
    parts.push(g.ms >= 1000 ? `${(g.ms / 1000).toFixed(g.ms >= 10_000 ? 0 : 1)}s` : `${g.ms}ms`);
    if (g.repaired) parts.push("repaired");
    return parts.join(" · ");
  });

  let commentText = $state("");
  let instruction = $state("");
  const whenFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const when = (at: string) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? "" : whenFormat.format(d);
  };
  let elementInstruction = $state("");

  /** A redraw request naming the blocking findings, for "Fix … with AI". */
  function fixInstruction(findings: Array<{ message: string }>): string {
    // The redraw instruction is capped at 2000 characters by the API.
    return ["Fix these problems and keep everything else:", ...findings.map((f) => `- ${f.message}`)].join("\n").slice(0, 1990);
  }
  let linkTarget = $state("");
  let confirmRemove = $state(false);
  let confirmClear = $state(false);

  const openComments = $derived((screen?.comments ?? []).filter((c) => !c.resolved_at));
  const elementComments = $derived(info?.nid ? (screen?.comments ?? []).filter((c) => c.nid === info.nid) : []);
  const componentName = $derived(info?.component ? (components[info.component] ?? null) : null);
  const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

  // Carry the open comments into one redraw instruction, so review notes on
  // the canvas become a single AI change.
  function commentsInstruction(): string {
    return [
      "Apply these review comments; keep everything else unchanged:",
      ...openComments.map((c) => `- On "${c.anchor || "the screen"}": ${c.text}`),
    ].join("\n");
  }
</script>

{#snippet commentList(list: UxComment[])}
  <ul class="flex flex-col gap-2">
    {#each list as c (c.id)}
      <li class="rounded-box border border-line p-2.5 text-[13px] {c.resolved_at ? 'opacity-60' : ''}">
        <button type="button" class="block w-full rounded-field text-left hover:bg-base-content/6" onclick={() => onFocusComment(c)}>
          <span class="block truncate text-xs text-base-content/75">{c.anchor || "Screen"}{c.nid ? "" : " · element no longer exists"}</span>
          <span class="mt-0.5 block whitespace-pre-wrap text-base-content">{c.text}</span>
          <span class="mt-1 block text-xs text-base-content/75">{time.format(new Date(c.created_at))}</span>
        </button>
        {#if editing}
          <div class="mt-1.5 flex gap-1">
            <button type="button" class="btn btn-ghost btn-xs" onclick={() => onCommentUpdate(c, c.resolved_at ? "reopen" : "resolve")} disabled={busy !== null}>
              {#if c.resolved_at}<RotateCcw class="size-3" aria-hidden="true" />Reopen{:else}<Check class="size-3" aria-hidden="true" />Resolve{/if}
            </button>
            <button type="button" class="btn btn-ghost btn-xs text-danger" onclick={() => onCommentUpdate(c, "delete")} disabled={busy !== null}>
              <Trash2 class="size-3" aria-hidden="true" />Delete
            </button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet label(text: string, forId?: string)}
  {#if forId}
    <label class="text-xs font-semibold text-base-content/80" for={forId}>{text}</label>
  {:else}
    <p class="text-xs font-semibold text-base-content/80">{text}</p>
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 text-[13px]">
  {#if error}<Notice tone="error">{error}</Notice>{/if}

  {#if info}
    <!-- ── Element ── -->
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="truncate text-xs text-base-content/75">{boardLabel}</p>
        <h2 class="line-clamp-2 break-words text-[14px] font-semibold text-base-content">
          {info.role}{#if info.text}{" "}<span class="font-normal text-base-content/80">“{info.text.length > 48 ? `${info.text.slice(0, 48)}…` : info.text}”</span>{/if}
        </h2>
      </div>
      <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={onSelectParent} aria-label="Select the parent (Esc)" title="Select the parent (Esc)">
        <ArrowUpLeft class="size-3.5" aria-hidden="true" />Parent
      </button>
    </div>

    <dl class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[13px]">
      {#if info.component}
        <dt class="text-base-content/75">Component</dt>
        <dd class="text-base-content">{componentName ?? info.component}{#if libraryName}<span class="text-base-content/75"> · {libraryName}</span>{/if}</dd>
      {/if}
      {#if info.text && info.text.length > 48}
        <dt class="text-base-content/75">Text</dt>
        <dd class="break-words text-base-content">{info.text}</dd>
      {/if}
      <dt class="text-base-content/75">Element</dt>
      <dd class="break-all font-mono text-xs text-base-content/80">&lt;{info.tag}&gt;{info.classes.length ? ` .${info.classes.join(" .")}` : ""}</dd>
      {#if info.inOverlay}
        <dt class="text-base-content/75">Where</dt>
        <dd class="text-base-content">Inside an overlay</dd>
      {/if}
      {#if info.linksTo && !editing}
        <dt class="text-base-content/75">Opens</dt>
        <dd class="text-base-content">{screens.find((s) => s.key === info.linksTo)?.name ?? info.linksTo}</dd>
      {/if}
    </dl>

    {#if editing}
      <div class="flex flex-col gap-3">
        {#if info.textEditable}
          <button type="button" class="btn btn-sm btn-outline justify-start" onclick={onEditText} disabled={busy !== null}>
            <Pencil class="size-3.5" aria-hidden="true" />Edit text <span class="ml-auto text-xs font-normal text-base-content/75">double-click</span>
          </button>
        {/if}

        <div class="flex flex-col gap-1.5">
          {@render label("Opens", "link-target")}
          <div class="flex gap-1.5">
            <select id="link-target" class="select select-sm min-w-0 flex-1" bind:value={linkTarget}>
              <option value="">{info.linksTo ? `${screens.find((s) => s.key === info.linksTo)?.name ?? info.linksTo} — change…` : "No link — choose…"}</option>
              {#each screens as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
            </select>
            <button type="button" class="btn btn-sm" onclick={() => { onLink(linkTarget); linkTarget = ""; }} disabled={!linkTarget || busy !== null}>
              <Link2 class="size-3.5" aria-hidden="true" />Link
            </button>
          </div>
          {#if info.linksTo}
            <button type="button" class="btn btn-ghost btn-xs self-start" onclick={() => onLink(null)} disabled={busy !== null}>
              <X class="size-3" aria-hidden="true" />Remove link
            </button>
          {/if}
        </div>
      </div>

      <!-- Only this element is redrawn; the rest of the screen stays as it is. -->
      <form
        class="flex flex-col gap-2 rounded-box bg-base-200 p-3"
        onsubmit={async (e) => {
          e.preventDefault();
          if (elementInstruction.trim().length >= 3 && (await onAiEdit(elementInstruction.trim()))) elementInstruction = "";
        }}
      >
        {@render label("Change with AI", "element-ai")}
        <textarea
          id="element-ai"
          class="textarea textarea-sm min-h-[64px] w-full bg-base-100"
          maxlength="2000"
          placeholder="e.g. Turn these filters into tabs"
          bind:value={elementInstruction}
        ></textarea>
        <button type="submit" class="btn btn-sm self-end" disabled={elementInstruction.trim().length < 3 || busy !== null || !info.nid}>
          {#if busy === "element"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Changing…{:else}<Sparkles class="size-3.5" aria-hidden="true" />Apply change{/if}
        </button>
      </form>

      <form class="flex flex-col gap-1.5" onsubmit={(e) => { e.preventDefault(); if (commentText.trim()) { onComment(commentText.trim()); commentText = ""; } }}>
        {@render label("Comment", "comment-text")}
        <textarea id="comment-text" class="textarea textarea-sm min-h-[56px] w-full" maxlength="2000" placeholder="e.g. Put this action in the row menu" bind:value={commentText}></textarea>
        <button type="submit" class="btn btn-sm btn-ghost self-end" disabled={!commentText.trim() || busy !== null || !info.nid}>
          <MessageSquarePlus class="size-3.5" aria-hidden="true" />Add comment
        </button>
      </form>
    {:else}
      <p class="text-xs text-base-content/75">Approved. Revise to edit.</p>
    {/if}

    {#if elementComments.length}
      <div class="flex flex-col gap-2 border-t border-line pt-3">
        {@render label("Comments here")}
        {@render commentList(elementComments)}
      </div>
    {/if}
  {:else if screen}
    <!-- ── Screen ── -->
    <div class="min-w-0">
      <p class="truncate text-xs text-base-content/75">{boardLabel}</p>
      <h2 class="text-[14px] font-semibold text-base-content">{screen.name}</h2>
      {#if screen.purpose}<p class="mt-1 text-base-content/80">{screen.purpose}</p>{/if}
    </div>

    {#if screen.screen_type || screen.requirement_keys.length || screen.primary_action?.label}
      <dl class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        {#if screen.screen_type}<dt class="text-base-content/75">Layout</dt><dd class="capitalize text-base-content">{screen.screen_type}</dd>{/if}
        {#if screen.requirement_keys.length}<dt class="text-base-content/75">Serves</dt><dd class="font-mono text-xs text-base-content">{screen.requirement_keys.join(", ")}</dd>{/if}
        {#if screen.primary_action?.label}<dt class="text-base-content/75">Primary</dt><dd class="text-base-content">{screen.primary_action.label}{#if screen.primary_action.result}<span class="block text-xs text-base-content/75">→ {screen.primary_action.result}</span>{/if}</dd>{/if}
      </dl>
    {/if}

    {#if projectLayout || screen.layout_reference || (editing && onLayout)}
      <!-- Which page this screen follows for layout: its own, the reference's, or none. -->
      {@const own = screen.layout_reference ?? null}
      {@const outdated = layoutStale({ layout_reference: projectLayout }, screen)}
      <div class="flex flex-col gap-1.5 rounded-box border border-line px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <p class="min-w-0 text-xs text-base-content/80">
            <span class="font-semibold">Layout:</span>
            {#if own}own — <span class="text-base-content">{own.name}</span>
            {:else if projectLayout}follows <span class="text-base-content">{projectLayout.name}</span>
            {:else}no reference{/if}
          </p>
          {#if editing && onLayout}
            <button type="button" class="btn btn-ghost btn-xs shrink-0" onclick={onLayout} disabled={busy !== null}>{own ? "Change" : "Set own"}</button>
          {/if}
        </div>
        {#if outdated}
          <p class="text-xs text-warn">Drawn before the layout reference changed — redraw to follow it.</p>
        {/if}
      </div>
    {/if}

    {#if screen.layout_note || screen.key_elements.length || screen.overlays?.length || screen.states?.length}
      <!-- The screen's plan: what it must show, its overlays and states. -->
      <details class="collapse collapse-arrow rounded-box border border-line">
        <summary class="collapse-title min-h-0 px-3 py-2 pe-8 text-xs font-semibold text-base-content/80">Screen plan</summary>
        <div class="collapse-content flex flex-col gap-3 px-3 pb-3">
          {#if screen.layout_note}
            <!-- The screen's composition plan: focus, arrangement, density, media, device adaptation. -->
            <p class="text-xs text-base-content/80"><span class="font-semibold">Composition:</span> {screen.layout_note}</p>
          {/if}
          {#if screen.key_elements.length}
            <div>
              {@render label("Must show")}
              <ul class="mt-1 flex flex-col gap-1 text-base-content/80">
                {#each screen.key_elements as el (el)}<li class="flex gap-1.5"><Check class="mt-0.5 size-3.5 shrink-0 text-base-content/75" aria-hidden="true" />{el}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if screen.overlays?.length}
            <div>
              {@render label("Overlays")}
              <ul class="mt-1 flex flex-col gap-1 text-base-content/80">
                {#each screen.overlays as o (o.name)}<li><span class="capitalize text-base-content">{o.kind}</span> · {o.name}{#if o.result}<span class="block text-xs">→ {o.result}</span>{/if}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if screen.states?.length}
            <!-- Every state is described here; at most two are drawn as frames. -->
            <div>
              {@render label("States")}
              <ul class="mt-1 flex flex-col gap-1 text-base-content/80">
                {#each screen.states as st (st.state)}<li><span class="text-base-content">{st.state}</span>{#if st.when} · {st.when}{/if}{#if st.response}<span class="block text-xs">{st.response}</span>{/if}</li>{/each}
              </ul>
              <p class="mt-1 text-xs text-base-content/75">Tasks build and test the behaviour.</p>
            </div>
          {/if}
        </div>
      </details>
    {/if}

    {#if screen.html}
      {@const blocking = (screen.lint ?? []).filter(blocksApproval)}
      {@const fixable = (screen.lint ?? []).filter((f) => blocksApproval(f) || f.repair)}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          {@render label("Checks")}
          {#if editing}
            <button type="button" class="btn btn-ghost btn-xs" onclick={onCheck} disabled={busy !== null} title="Lay the screen out at phone and desktop width and check it again — no AI call">
              {#if busy === "check"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<ScanSearch class="size-3.5" aria-hidden="true" />{/if}Check again
            </button>
          {/if}
        </div>
        {#if screen.lint?.length}
          <ul class="flex flex-col gap-1">
            {#each screen.lint as f (f.rule)}
              <li class="flex gap-1.5 {blocksApproval(f) ? 'text-danger' : 'text-base-content/80'}"><CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{#if blocksApproval(f)}<span class="font-semibold">Blocks approval: </span>{/if}{f.message}</span></li>
            {/each}
          </ul>
          {#if blocking.length}<p class="text-xs text-danger">{blocking.length === 1 ? "One finding blocks" : `${blocking.length} findings block`} approval until fixed.</p>{/if}
          {#if editing && fixable.length}
            <button
              type="button"
              class="btn btn-sm btn-outline mt-1 w-full"
              disabled={busy !== null}
              onclick={() => onRedraw(fixInstruction(fixable))}
            ><Sparkles class="size-3.5" aria-hidden="true" />Fix {fixable.length === 1 ? "this" : `these ${fixable.length}`} with AI</button>
          {/if}
        {:else}
          <p class="flex items-center gap-1.5 text-mint"><CircleCheck class="size-3.5 shrink-0" aria-hidden="true" />No problems found</p>
        {/if}
      </div>
    {/if}

    {#if screen.html && generation}
      <!-- What the last AI drawing used and cost; a cut-off answer is the one thing worth acting on. -->
      <div class="flex flex-col gap-1">
        <p class="text-xs text-base-content/75" title={generation.provider ? `Provider: ${generation.provider}` : undefined}>Last drawing: {generationLine}</p>
        {#if generation.truncated}
          <p class="flex gap-1.5 text-xs text-warn" role="status"><CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Cut off at the output limit — raise max_tokens on the AI profile.</p>
        {/if}
      </div>
    {/if}

    {#if screen.html && screen.render_checked === false}
      <!-- A render that did not run (or no longer matches this drawing) is said so, never shown as passed. -->
      <p class="flex gap-1.5 text-xs text-base-content/80" role="status">
        <CircleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Render check not run for this drawing — overflow and contrast are unchecked until it is re-checked or approved.
      </p>
    {/if}

    {#if screen.html && onReview}
      <VisualReview {screen} {editing} {busy} onSave={onReview} />
    {/if}

    {#if editing}
      {#if !screen.html}
        <button type="button" class="btn btn-sm btn-outline" onclick={onDraw} disabled={busy !== null}><Sparkles class="size-3.5" aria-hidden="true" />Draw this screen</button>
      {:else}
        <form class="flex flex-col gap-2 rounded-box bg-base-200 p-3" onsubmit={(e) => { e.preventDefault(); if (instruction.trim()) { onRedraw(instruction.trim()); instruction = ""; } }}>
          {@render label("Change with AI", "redraw")}
          <textarea id="redraw" class="textarea textarea-sm min-h-[64px] w-full bg-base-100" maxlength="2000" placeholder="e.g. Move the filters into a sheet" bind:value={instruction}></textarea>
          <button type="submit" class="btn btn-sm self-end" disabled={!instruction.trim() || busy !== null}>
            {#if busy === "redraw"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<RefreshCw class="size-3.5" aria-hidden="true" />{/if}Redraw screen
          </button>
        </form>
        {#if openComments.length}
          <button type="button" class="btn btn-sm btn-outline" onclick={() => onRedraw(commentsInstruction())} disabled={busy !== null}>
            <Sparkles class="size-3.5" aria-hidden="true" />Apply {openComments.length} comment{openComments.length === 1 ? "" : "s"} with AI
          </button>
        {/if}
      {/if}
    {/if}

    {#if screen.comments?.length}
      <div class="flex flex-col gap-2 border-t border-line pt-3">
        {@render label(`Comments · ${openComments.length} open`)}
        {@render commentList(screen.comments)}
      </div>
    {/if}

    {#if editing && (screen.html || screen.history?.length || screens.length > 1)}
      <!-- Quiet, at the foot: take back a change, earlier versions, clear the drawing, remove the screen. -->
      <div class="mt-auto flex flex-col gap-1 border-t border-line pt-3">
        {#if screen.history?.length}
          <button type="button" class="btn btn-sm btn-ghost w-full justify-start font-normal" onclick={onUndo} disabled={busy !== null} title={screen.history[0]!.note}>
            <Undo2 class="size-3.5 shrink-0" aria-hidden="true" /><span class="min-w-0 truncate">Undo: {screen.history[0]!.note}</span>
          </button>
          <!-- Every kept version; restoring one keeps the current one here, so it can be taken back. -->
          <details class="collapse collapse-arrow rounded-field" open={busy === "restore"}>
            <summary class="collapse-title flex min-h-0 items-center gap-1.5 px-3 py-2 pe-8 text-[13px] text-base-content/80">
              <History class="size-3.5" aria-hidden="true" />History<span class="text-base-content/75">· {screen.history.length}</span>
            </summary>
            <div class="collapse-content p-0">
              <ol class="flex flex-col rounded-box border border-line">
                <li class="flex items-center gap-2 px-2.5 py-2 text-xs">
                  <span class="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
                  <span class="font-semibold text-base-content">{screen.html ? "Current version" : "Now: not drawn"}</span>
                </li>
                {#each screen.history as version, index (version.at + index)}
                  <li class="flex items-start gap-2 border-t border-line px-2.5 py-2 text-xs">
                    <span class="mt-1 size-2 shrink-0 rounded-full border border-base-content/40" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1">
                      <span class="line-clamp-2 break-words text-base-content" title={version.note}>Before: {version.note}</span>
                      <span class="block text-base-content/75">{when(version.at)}</span>
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs shrink-0"
                      onclick={() => onRestore(index)}
                      disabled={busy !== null}
                      aria-label={`Restore the version before: ${version.note}`}
                    >
                      {#if busy === "restore"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<RotateCcw class="size-3" aria-hidden="true" />{/if}Restore
                    </button>
                  </li>
                {/each}
              </ol>
              <p class="px-1 pt-1.5 text-xs text-base-content/75">Keeps the last 5 versions.</p>
            </div>
          </details>
        {/if}
        {#if screen.html}
          <!-- The plan stays (what it must show, requirements, states); only the drawing goes. -->
          {#if confirmClear}
            <div class="flex flex-wrap items-center gap-1.5 px-1">
              <span class="text-xs text-base-content/80">Clear the drawing? The screen's plan stays.</span>
              <button type="button" class="btn btn-ghost btn-xs" onclick={() => (confirmClear = false)}>Keep</button>
              <button type="button" class="btn btn-xs btn-outline" onclick={() => { confirmClear = false; onClear(); }}>Clear</button>
            </div>
          {:else}
            <button type="button" class="btn btn-ghost btn-sm justify-start font-normal" onclick={() => (confirmClear = true)} disabled={busy !== null} title="Keep the screen's plan and draw it again from scratch">
              {#if busy === "clear"}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Eraser class="size-3.5" aria-hidden="true" />{/if}Clear drawing
            </button>
          {/if}
        {/if}
        {#if screens.length > 1}
          {#if confirmRemove}
            <div class="flex items-center gap-1.5 px-1">
              <span class="text-xs text-base-content/80">Remove this screen?</span>
              <button type="button" class="btn btn-ghost btn-xs" onclick={() => (confirmRemove = false)}>Keep</button>
              <button type="button" class="btn btn-xs btn-outline text-danger" onclick={() => { confirmRemove = false; onRemove(); }}>Remove</button>
            </div>
          {:else}
            <button type="button" class="btn btn-ghost btn-sm justify-start font-normal text-danger" onclick={() => (confirmRemove = true)} disabled={busy !== null}>
              <Trash2 class="size-3.5" aria-hidden="true" />Remove screen
            </button>
          {/if}
        {/if}
      </div>
    {/if}
  {:else}
    <div>
      <h2 class="text-[14px] font-semibold text-base-content">Nothing selected</h2>
      <p class="mt-1 text-base-content/80">Click an element to inspect it; double-click text to edit.</p>
    </div>
    <details class="collapse collapse-arrow rounded-box border border-line">
      <summary class="collapse-title min-h-0 px-3 py-2 pe-8 text-xs font-semibold text-base-content/80">Shortcuts</summary>
      <ul class="collapse-content flex flex-col gap-1.5 px-3 pb-3 text-base-content/80">
        <li><kbd class="kbd kbd-sm">V</kbd> select · <kbd class="kbd kbd-sm">H</kbd> hand · <kbd class="kbd kbd-sm">C</kbd> comment</li>
        <li><kbd class="kbd kbd-sm">Esc</kbd> select the parent</li>
        <li><kbd class="kbd kbd-sm">[</kbd> <kbd class="kbd kbd-sm">]</kbd> previous / next screen</li>
        <li>Arrow keys or scroll to pan</li>
        <li><kbd class="kbd kbd-sm">+</kbd> <kbd class="kbd kbd-sm">-</kbd> or Ctrl + scroll to zoom</li>
        <li><kbd class="kbd kbd-sm">Shift</kbd> <kbd class="kbd kbd-sm">1</kbd> fit everything</li>
      </ul>
    </details>
  {/if}
</div>
