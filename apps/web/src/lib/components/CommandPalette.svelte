<script lang="ts" module>
  /** Search index for one project, fetched when the palette opens and kept
   * for a minute (and until the app's data is invalidated), so new tasks and
   * bugs show up. A failed load is never kept: the next open retries. */
  export interface PaletteIndex {
    tasks: Array<{ id: string; key: string; title: string }>;
    requirements: Array<{ key: string; title: string }>;
    bugs: Array<{ id: string; key: string; title: string }>;
    screens: Array<{ key: string; name: string }>;
  }

  const INDEX_TTL_MS = 60_000;
  const indexRequests = new Map<string, { at: number; req: Promise<PaletteIndex | null> }>();

  function loadIndex(projectId: string): Promise<PaletteIndex | null> {
    const hit = indexRequests.get(projectId);
    if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.req;
    const entry = { at: Date.now(), req: null as unknown as Promise<PaletteIndex | null> };
    entry.req = fetch(`/api/palette/${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PaletteIndex>) : null))
      .catch(() => null)
      .then((idx) => {
        // Only drop our own entry: a newer request may have replaced it.
        if (!idx && indexRequests.get(projectId) === entry) indexRequests.delete(projectId);
        return idx;
      });
    indexRequests.set(projectId, entry);
    return entry.req;
  }

  function forgetIndex(projectId: string): void {
    indexRequests.delete(projectId);
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { lifecycleLabel } from "$lib/labels.js";
  import {
    Search,
    LayoutDashboard,
    FileText,
    ListChecks,
    Kanban,
    Bug,
    Radar,
    PlusCircle,
    Cpu,
    Sparkles,
    FolderKanban,
    Layers,
    Monitor,
    SquareCheck,
  } from "lucide-svelte";

  interface Project {
    id: string;
    key: string;
    name: string;
    lifecycleStatus: string;
  }

  interface CommandItem {
    id: string;
    group: string;
    title: string;
    subtitle?: string;
    key?: string;
    /** Extra words the query matches, never shown. */
    keywords?: string;
    icon: typeof Search;
    action: () => void | Promise<void>;
  }

  const MAX_PER_GROUP = 8;
  /** The current project's pages: listed first, and first again when searching. */
  const GO_TO = "Go to";

  let {
    open = $bindable(false),
    projects = [],
    currentProjectId = null,
  }: {
    open?: boolean;
    projects?: Project[];
    currentProjectId?: string | null;
  } = $props();

  let query = $state("");

  // Fresh search on every open.
  $effect(() => {
    if (open) query = "";
  });

  // Keyboard highlight (combobox + listbox): the input keeps focus and points
  // at the highlighted option with aria-activedescendant.
  let active = $state(0);

  // Project search index: loaded when the palette opens on a project, and
  // again on a later open once it is older than the TTL. A stale index stays
  // on screen while the fresh one loads.
  let indexes = $state<Record<string, { at: number; index: PaletteIndex }>>({});
  let loadingIndex = $state(false);

  $effect(() => {
    const pid = currentProjectId;
    if (!open || !pid) return;
    const have = indexes[pid];
    if (have && Date.now() - have.at < INDEX_TTL_MS) return;
    let cancelled = false;
    loadingIndex = true;
    void loadIndex(pid).then((idx) => {
      if (cancelled) return;
      loadingIndex = false;
      if (idx) indexes[pid] = { at: Date.now(), index: idx };
    });
    return () => {
      cancelled = true;
      loadingIndex = false;
    };
  });

  // Any form action or invalidate() re-runs the project layout, which hands
  // out a new journey object: the project's tasks or bugs may have changed,
  // so the cached index goes too.
  $effect(() => {
    void page.data.journey;
    const pid = untrack(() => currentProjectId);
    if (!pid) return;
    forgetIndex(pid);
    untrack(() => {
      if (indexes[pid]) indexes[pid] = { ...indexes[pid], at: 0 };
    });
  });

  const projectIndex = $derived(currentProjectId ? (indexes[currentProjectId]?.index ?? null) : null);

  const currentProject = $derived(
    currentProjectId ? projects.find((p) => p.id === currentProjectId) : null,
  );

  const allItems = $derived.by(() => {
    const items: CommandItem[] = [];

    if (currentProjectId) {
      const pid = currentProjectId;
      items.push(
        // Titles only: letter badges here looked like shortcuts but did nothing.
        { id: `proj-plan-${pid}`, group: GO_TO, title: "Notebook", keywords: "plan journey overview", icon: LayoutDashboard, action: () => goto(`/projects/${pid}`) },
        { id: `proj-req-${pid}`, group: GO_TO, title: "Requirements", icon: FileText, action: () => goto(`/projects/${pid}/docs?tab=requirements`) },
        { id: `proj-stack-${pid}`, group: GO_TO, title: "Tech stack", icon: Layers, action: () => goto(`/projects/${pid}/stack`) },
        { id: `proj-design-${pid}`, group: GO_TO, title: "Technical design", icon: FileText, action: () => goto(`/projects/${pid}/docs?tab=design`) },
        { id: `proj-ux-${pid}`, group: GO_TO, title: "UI reference", keywords: "screens mockups", icon: Monitor, action: () => goto(`/projects/${pid}/ux`) },
        { id: `proj-tasks-${pid}`, group: GO_TO, title: "Tasks", icon: ListChecks, action: () => goto(`/projects/${pid}/tasks`) },
        { id: `proj-board-${pid}`, group: GO_TO, title: "Board", icon: Kanban, action: () => goto(`/projects/${pid}/board`) },
        { id: `proj-bugs-${pid}`, group: GO_TO, title: "Bugs", icon: Bug, action: () => goto(`/projects/${pid}/bugs`) },
        { id: `proj-cvg-${pid}`, group: GO_TO, title: "Release check", keywords: "convergence", icon: Radar, action: () => goto(`/projects/${pid}/convergence`) },
      );
    }

    items.push({
      id: "action-new-project",
      group: "Actions",
      title: "New project",
      keywords: "start from an idea",
      icon: PlusCircle,
      action: () => goto("/"),
    });

    items.push(
      { id: "nav-ai", group: "Settings", title: "AI providers", keywords: "keys models role routing", icon: Sparkles, action: () => goto("/settings/ai") },
      { id: "nav-machines", group: "Settings", title: "Machines", keywords: "local agents that run tasks", icon: Cpu, action: () => goto("/machines") },
    );

    for (const p of projects) {
      if (p.id === currentProjectId) continue;
      items.push({
        id: `switch-proj-${p.id}`,
        group: "Switch project",
        title: p.name,
        key: p.key,
        subtitle: lifecycleLabel(p.lifecycleStatus),
        icon: FolderKanban,
        action: () => goto(`/projects/${p.id}`),
      });
    }

    return items;
  });

  // Project records matching the query. Every word must appear in the key or
  // title (never the group name, or "tasks" would list every task); key-prefix
  // matches rank first.
  const searchItems = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const pid = currentProjectId;
    if (!q || !pid || !projectIndex) return [] as CommandItem[];
    const words = q.split(/\s+/);
    function pick<T>(rows: T[], key: (r: T) => string, title: (r: T) => string): T[] {
      return rows
        .filter((r) => {
          const hay = `${key(r)} ${title(r)}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .sort((a, b) => Number(key(b).toLowerCase().startsWith(q)) - Number(key(a).toLowerCase().startsWith(q)))
        .slice(0, MAX_PER_GROUP);
    }

    const items: CommandItem[] = [];
    for (const t of pick(projectIndex.tasks, (t) => t.key, (t) => t.title)) {
      items.push({ id: `task-${t.id}`, group: "Tasks", title: t.title || t.key, key: t.key, icon: SquareCheck, action: () => goto(`/projects/${pid}/tasks/${t.id}`) });
    }
    for (const r of pick(projectIndex.requirements, (r) => r.key, (r) => r.title)) {
      items.push({ id: `req-${r.key}`, group: "Requirements", title: r.title || r.key, key: r.key, icon: FileText, action: () => goto(`/projects/${pid}/docs?tab=requirements`) });
    }
    for (const b of pick(projectIndex.bugs, (b) => b.key, (b) => b.title)) {
      items.push({ id: `bug-${b.id}`, group: "Bugs", title: b.title || b.key, key: b.key, icon: Bug, action: () => goto(`/projects/${pid}/bugs`) });
    }
    for (const sc of pick(projectIndex.screens, (sc) => sc.key, (sc) => sc.name)) {
      items.push({ id: `screen-${sc.key || sc.name}`, group: "UI reference screens", title: sc.name, icon: Monitor, action: () => goto(`/projects/${pid}/ux`) });
    }
    return items;
  });

  // The match covers title + key + subtitle + group, not just the title.
  const filteredItems = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    const pages = allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.key && item.key.toLowerCase().includes(q)) ||
        (item.keywords && item.keywords.includes(q)) ||
        item.group.toLowerCase().includes(q),
    );
    // Project pages first, then project records, then everything else.
    const current = pages.filter((i) => i.group === GO_TO);
    const rest = pages.filter((i) => i.group !== GO_TO);
    return [...current, ...searchItems, ...rest];
  });

  // Consecutive chunks so each group renders one labelled section. `n` is the
  // item's place in the flat list the arrow keys walk.
  const groups = $derived.by(() => {
    const out: Array<{ label: string; items: Array<CommandItem & { n: number }> }> = [];
    filteredItems.forEach((item, n) => {
      const last = out.at(-1);
      if (last && last.label === item.group) last.items.push({ ...item, n });
      else out.push({ label: item.group, items: [{ ...item, n }] });
    });
    return out;
  });

  // A new query starts at the top again.
  $effect(() => {
    void query;
    active = 0;
  });

  // Keep the highlighted option in view while the arrows walk the list.
  $effect(() => {
    if (!open) return;
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  });

  function selectItem(item: CommandItem) {
    open = false;
    void item.action();
  }

  function onInputKeydown(e: KeyboardEvent) {
    const count = filteredItems.length;
    if (!count) return;
    if (e.key === "ArrowDown") active = (active + 1) % count;
    else if (e.key === "ArrowUp") active = (active - 1 + count) % count;
    else if (e.key === "Home" && e.ctrlKey) active = 0;
    else if (e.key === "End" && e.ctrlKey) active = count - 1;
    else if (e.key === "Enter") selectItem(filteredItems[Math.min(active, count - 1)]);
    else return;
    e.preventDefault();
  }
</script>

<Modal
  bind:open
  labelledby="palette-title"
  describedby="palette-desc"
  boxClass="mt-24 flex max-w-[560px] flex-col self-start overflow-hidden rounded-box border border-line p-0 max-sm:mt-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0"
>
  <h2 id="palette-title" class="sr-only">Command palette</h2>
  <p id="palette-desc" class="sr-only">
    Search pages and projects, and inside a project its tasks, requirements, bugs and screens. Arrow keys move, Enter opens.
  </p>

  <!-- The field is the dialog's one focus: its bottom rule turns green instead of a ring.
       Phones: the palette is full screen — a top bar with the field as a pill and Cancel. -->
  <div class="flex shrink-0 items-center max-sm:h-14 max-sm:gap-1 max-sm:border-b max-sm:border-line max-sm:bg-base-100 max-sm:pr-2 max-sm:pl-4">
  <label class="flex h-14 w-full items-center gap-3 border-b border-line px-[18px] focus-within:border-primary-ink max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 max-sm:gap-2 max-sm:rounded-field max-sm:border max-sm:border-line-control max-sm:px-4 max-sm:focus-within:border-primary-ink max-sm:focus-within:shadow-[0_0_0_1px_var(--color-primary-ink)]">
    <Search class="size-4 shrink-0 text-base-content/75" aria-hidden="true" />
    <input
      bind:value={query}
      type="text"
      role="combobox"
      aria-label="Search pages, tasks, requirements and bugs"
      aria-expanded="true"
      aria-controls="palette-list"
      aria-autocomplete="list"
      aria-activedescendant={filteredItems.length ? `palette-opt-${active}` : undefined}
      autocomplete="off"
      spellcheck="false"
      class="min-w-0 grow bg-transparent text-[16px] text-base-content outline-none placeholder:text-base-content/75 focus-visible:outline-none sm:text-[15px]"
      placeholder="Search"
      style="outline: none"
      onkeydown={onInputKeydown}
    />
    <kbd class="kbd kbd-sm hidden font-mono text-xs sm:inline-flex">Esc</kbd>
  </label>
  <button type="button" class="btn btn-ghost h-11 shrink-0 px-2.5 sm:hidden" onclick={() => (open = false)}>Cancel</button>
  </div>

  <div id="palette-list" role="listbox" aria-label="Results" class="max-h-[400px] overflow-y-auto px-2 pt-1.5 pb-2.5 max-sm:max-h-none max-sm:min-h-0 max-sm:flex-1 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    {#if filteredItems.length === 0}
      <p class="p-8 text-center text-[13px] text-base-content/75" role="status">
        {#if loadingIndex && query.trim()}
          Searching {currentProject?.key ?? "this project"}…
        {:else}
          Nothing matches <span class="font-medium text-base-content">"{query}"</span>
        {/if}
      </p>
    {/if}

    {#each groups as group, gi (group.label)}
      <ul class="flex flex-col" role="group" aria-labelledby={`palette-group-${gi}`}>
        <li id={`palette-group-${gi}`} class="px-3 pt-2 pb-1 text-xs font-medium text-base-content/75" role="presentation">
          {group.label}
        </li>
        {#each group.items as item (item.id)}
          <li role="presentation">
            <!-- The input owns the keys (aria-activedescendant); a click picks too. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              id={`palette-opt-${item.n}`}
              role="option"
              tabindex="-1"
              aria-selected={item.n === active}
              class="flex min-h-[38px] cursor-pointer items-center justify-between gap-3 rounded-[0.75rem] px-3 text-[13px] max-sm:min-h-12 max-sm:text-[15px] {item.n === active
                ? 'bg-primary-soft text-base-content'
                : 'text-base-content/80'}"
              onpointermove={() => (active = item.n)}
              onclick={() => selectItem(item)}
            >
              <span class="flex min-w-0 items-center gap-2.5 max-sm:gap-3">
                <item.icon class="size-4 shrink-0 {item.n === active ? 'text-primary-ink' : 'text-base-content/75'}" aria-hidden="true" />
                <span class="truncate font-medium text-base-content">{item.title}</span>
                {#if item.subtitle}
                  <span class="truncate text-xs text-base-content/75">· {item.subtitle}</span>
                {/if}
              </span>
              {#if item.key}
                <span class="shrink-0 font-mono text-xs font-medium tracking-tight text-base-content/75">{item.key}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/each}
  </div>
</Modal>
