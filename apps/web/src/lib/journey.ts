/**
 * The path from an idea to a released, verified feature set — the product's
 * whole job (PRODUCT.md, "The one job"). Every milestone is derived from real
 * project state, never from a "seen" flag, so the guidance moves on by itself
 * as the work is done and never nags a returning user.
 *
 * The same `next` action is shown everywhere in the project (NextStepBar), so
 * the way forward never depends on a one-off notice that a reload would lose.
 */

export type MilestoneState = "done" | "current" | "draft" | "todo" | "skipped";

export type MilestoneId = "discover" | "requirements" | "stack" | "design" | "system" | "screens" | "tasks" | "build" | "release";

/**
 * One chapter of the project notebook. The chapters are the project's only
 * navigation (the sidebar chapter line, the notebook page): every project page
 * belongs to exactly one of them.
 */
export interface Milestone {
  id: MilestoneId;
  /** 1-based chapter number. */
  n: number;
  label: string;
  state: MilestoneState;
  /** Where the chapter's work lives. */
  href: string;
  /** What the chapter holds, in one line: shown before it has started. */
  blurb: string;
  /** Where it stands, in one line, from the project's data (e.g. "v2 approved · 12 requirements"). */
  summary: string;
  /** Optional chapters say so, and may be skipped without blocking the path. */
  optional?: boolean;
}

/** Which chapter a project page belongs to; "overview" is the notebook itself. */
export type ChapterId = MilestoneId | "overview";

export function chapterFor(pathname: string, search: URLSearchParams, projectId: string): ChapterId {
  const rest = pathname.split(`/projects/${projectId}`)[1] ?? "";
  const [section = "", sub = ""] = rest.replace(/^\//, "").split("/");
  switch (section) {
    case "":
      return "overview";
    case "discovery":
      return "discover";
    case "docs": {
      const tab = sub || search.get("tab") || "requirements";
      return tab === "design" ? "design" : tab === "stack" ? "stack" : tab === "system" ? "system" : tab === "ux" ? "screens" : "requirements";
    }
    case "stack":
      return "stack";
    case "design-system":
      return "system";
    case "ux":
      return "screens";
    case "tasks":
      return "tasks";
    case "board":
    case "bugs":
      return "build";
    case "convergence":
      return "release";
    default:
      return "overview";
  }
}

export type JourneyAction = "?/generateDesign" | "?/generateTasks";

export interface NextAction {
  milestone: MilestoneId;
  /** Short imperative, shown as the heading. */
  title: string;
  /** One sentence: what happens and why it matters now. */
  detail: string;
  /** Button label — names the action, not the destination. */
  cta: string;
  /** Navigation target, or a form action on the Plan page. */
  href?: string;
  action?: JourneyAction;
  /** An optional detour offered next to the primary action. */
  secondary?: { label: string; href?: string; action?: JourneyAction };
}

export interface JourneyInput {
  unavailable?: MilestoneId[];
  projectId: string;
  lifecycle: string;
  requirements: { approved: boolean; hasDraft: boolean };
  stackApproved: boolean;
  design: { approved: boolean; hasDraft: boolean };
  ux: { approved: boolean; hasDraft: boolean; notApplicable: boolean };
  /** The optional design system (look + component library). Absent = unknown. */
  designSystem?: { approved: boolean; hasDraft: boolean };
  tasks: Array<{ id: string; key: string; title: string; workflowStatus: string }>;
  /** Each feature with its latest release-check verdict. */
  features: Array<{ status: string; checked?: boolean; canComplete?: boolean }>;
  /** Which generation roles have a model; without one the step is written by hand. */
  ai?: { design: boolean };
  /** Detail for the chapter summaries; every field optional (a failed call just says less). */
  facts?: {
    requirements?: { count: number; must: number; version: number | null };
    stack?: { hasDraft: boolean; version: number | null };
    design?: { version: number | null };
    screens?: { count: number; version: number | null };
    system?: { name: string | null };
  };
}

export interface Journey {
  milestones: Milestone[];
  next: NextAction;
  /** 1-based number of the chapter the next action belongs to — never behind or ahead of it. */
  step: number;
  total: number;
  /** Every chapter done or skipped. */
  finished: boolean;
}

/** What each chapter holds, said before it starts. */
const BLURB: Record<MilestoneId, string> = {
  discover: "Answer questions about the idea — each answer becomes a fact the requirements build on.",
  requirements: "Numbered requirements with acceptance criteria, approved before any technology is chosen.",
  stack: "The technologies the design and the tasks are written against — recommended, or picked by hand.",
  design: "Architecture, data model, API contracts and the test strategy, written against the locked stack.",
  system: "The look and the component library the screens and the tasks use.",
  screens: "Mockups of the key screens; tasks follow their layout, elements and flow.",
  tasks: "Bounded work orders, each traced to requirements, with the commands that prove it is done.",
  build: "Agents claim, run and submit the tasks; you review the evidence they attach.",
  release: "Checks the built work against the approved requirements, feature by feature.",
};

const STARTED = new Set(["CLAIMED", "IN_PROGRESS", "VALIDATING", "NEEDS_REVIEW", "CHANGES_REQUESTED", "BLOCKED", "DONE"]);
const DISCOVERY_OPEN = new Set(["IDEA_DRAFT", "DISCOVERY_ACTIVE"]);

export function buildJourney(input: JourneyInput): Journey {
  const p = input.projectId;
  const discovered = !DISCOVERY_OPEN.has(input.lifecycle) || input.requirements.approved;
  const live = input.tasks.filter((t) => t.workflowStatus !== "CANCELLED");
  const drafts = live.filter((t) => t.workflowStatus === "DRAFT");
  const ready = live.filter((t) => t.workflowStatus === "READY");
  const review = live.filter((t) => t.workflowStatus === "NEEDS_REVIEW");
  const started = live.some((t) => STARTED.has(t.workflowStatus));
  const tasksLive = live.length > 0 && drafts.length === 0 && (ready.length > 0 || started);
  const built = live.length > 0 && live.every((t) => t.workflowStatus === "DONE");
  const released = input.features.length > 0 && input.features.every((f) => f.status === "CANCELLED" || (f.status === "COMPLETE" && f.checked !== false && f.canComplete !== false));

  // The UI reference is optional: it never blocks the path, and once tasks
  // exist without it, it counts as skipped rather than as "still to do".
  const screensDone = input.ux.approved || input.ux.notApplicable;
  const screensSkipped = !screensDone && !input.ux.hasDraft && input.tasks.length > 0;
  // The design system is optional in the same way; it comes before the
  // screens, so once they have started without it, it was skipped.
  const uxStarted = input.ux.approved || input.ux.hasDraft || input.ux.notApplicable;
  const system = input.designSystem ?? { approved: false, hasDraft: false };
  const systemSkipped = !system.approved && !system.hasDraft && (input.tasks.length > 0 || uxStarted);

  const f = input.facts ?? {};
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const done = live.filter((t) => t.workflowStatus === "DONE").length;
  const complete = input.features.filter((x) => x.status === "COMPLETE").length;

  const raw: Array<{ id: MilestoneId; label: string; done: boolean; draft: boolean; href: string; optional?: boolean; summary: string }> = [
    {
      id: "discover",
      label: "Discovery",
      done: discovered,
      draft: false,
      href: `/projects/${p}/discovery`,
      summary: discovered ? "Complete" : input.lifecycle === "DISCOVERY_ACTIVE" ? "In progress" : "Not started",
    },
    {
      id: "requirements",
      label: "Requirements",
      done: input.requirements.approved,
      draft: input.requirements.hasDraft,
      href: `/projects/${p}/docs?tab=requirements`,
      summary: f.requirements?.count
        ? `${f.requirements.version ? `v${f.requirements.version} ` : ""}${input.requirements.approved ? "approved" : "draft"} · ${plural(f.requirements.count, "requirement")}${f.requirements.must ? `, ${f.requirements.must} P0` : ""}`
        : input.requirements.hasDraft
          ? "Draft ready"
          : "Not written",
    },
    {
      id: "stack",
      label: "Stack",
      done: input.stackApproved,
      draft: Boolean(f.stack?.hasDraft) && !input.stackApproved,
      href: `/projects/${p}/stack`,
      summary: input.stackApproved ? `Locked${f.stack?.version ? ` · v${f.stack.version}` : ""}` : f.stack?.hasDraft ? "Recommendation ready" : "Not chosen",
    },
    {
      id: "design",
      label: "Technical design",
      done: input.design.approved,
      draft: input.design.hasDraft,
      href: `/projects/${p}/docs?tab=design`,
      summary: input.design.approved
        ? `v${f.design?.version ?? "?"} approved${input.design.hasDraft ? " · newer draft waiting" : ""}`
        : input.design.hasDraft
          ? "Draft ready"
          : "Not written",
    },
    {
      id: "system",
      label: "Design system",
      done: system.approved,
      draft: system.hasDraft && !system.approved,
      href: `/projects/${p}/design-system`,
      optional: true,
      summary: system.approved ? `Approved${f.system?.name ? ` · ${f.system.name}` : ""}` : system.hasDraft ? "Draft ready" : systemSkipped ? "Skipped" : "Optional",
    },
    {
      id: "screens",
      label: "UI reference",
      done: screensDone,
      draft: input.ux.hasDraft && !input.ux.approved,
      href: `/projects/${p}/ux`,
      optional: true,
      summary: input.ux.notApplicable
        ? "No screens — no visual interface"
        : input.ux.approved
          ? `${f.screens?.count ? plural(f.screens.count, "screen") : "Screens"} approved${input.ux.hasDraft ? " · newer draft waiting" : ""}`
          : input.ux.hasDraft
            ? "Draft ready"
            : screensSkipped
              ? "Skipped"
              : "Optional",
    },
    {
      id: "tasks",
      label: "Tasks",
      done: tasksLive || built,
      draft: drafts.length > 0,
      href: `/projects/${p}/tasks`,
      summary: live.length ? `${plural(live.length, "task")}${drafts.length ? ` · ${drafts.length} draft` : ""}${ready.length ? ` · ${ready.length} ready` : ""}` : "Not generated",
    },
    {
      id: "build",
      label: "Build",
      done: built,
      draft: false,
      href: `/projects/${p}/board`,
      summary: live.length && (started || built) ? `${done} of ${live.length} done${review.length ? ` · ${review.length} to review` : ""}` : "Not started",
    },
    {
      id: "release",
      label: "Release check",
      done: released,
      draft: false,
      href: `/projects/${p}/convergence`,
      summary: input.features.length && built ? `${complete} of ${plural(input.features.length, "feature")} complete` : "After the build",
    },
  ];

  const next: NextAction = (() => {
    if (input.unavailable?.length) return { milestone: input.unavailable[0]!, title: "Reload project status", detail: "Some chapter data could not be loaded. Reload before generating or approving more work.", cta: "Reload project", href: `/projects/${p}` };
    if (!discovered) {
      return { milestone: "discover", title: "Answer the discovery questions", detail: "One question at a time about the idea — each answer goes into the brief your requirements are written from.", cta: "Continue discovery", href: `/projects/${p}/discovery` };
    }
    if (!input.requirements.approved) {
      return input.requirements.hasDraft
        ? { milestone: "requirements", title: "Review and approve the requirements", detail: "A requirements draft is ready. Approving it locks this version; everything after it is built from it.", cta: "Review requirements", href: `/projects/${p}/docs?tab=requirements` }
        : { milestone: "requirements", title: "Write the requirements", detail: "Turn the discovery answers into numbered requirements with acceptance criteria — generated, or written by hand.", cta: "Create requirements", href: `/projects/${p}/docs?tab=requirements` };
    }
    if (!input.stackApproved) {
      return { milestone: "stack", title: "Choose the technology stack", detail: "Pick the stack yourself or take a recommendation. The design is written against this choice.", cta: "Choose stack", href: `/projects/${p}/stack` };
    }
    if (!input.design.approved) {
      return input.design.hasDraft
        ? { milestone: "design", title: "Review and approve the design", detail: "The technical design draft is ready. Approve it to unlock the screens and the tasks.", cta: "Review design", href: `/projects/${p}/docs?tab=design` }
        : input.ai && !input.ai.design
          ? { milestone: "design", title: "Write the technical design", detail: "No AI model is connected for design, so describe the architecture, data model and tests yourself.", cta: "Write the design", href: `/projects/${p}/docs/design/edit` }
          : {
              milestone: "design",
              title: "Generate the technical design",
              detail: "Architecture, data model and contracts, derived from the approved requirements and stack.",
              cta: "Generate design",
              action: "?/generateDesign",
              secondary: { label: "Write it yourself", href: `/projects/${p}/docs/design/edit` },
            };
    }
    if (input.tasks.length === 0) {
      // After the design the path runs design system → UI reference → tasks:
      // each optional step is the primary action until it is done or skipped,
      // and skipping one moves on to the next (no "seen" flag: a skipped design
      // system is one with nothing drawn, once the screens have started).
      const skipSystem: NextAction["secondary"] = screensDone
        ? { label: "Skip — generate tasks", action: "?/generateTasks" }
        : { label: "Skip — sketch the screens", href: `/projects/${p}/ux` };
      if (system.hasDraft && !system.approved) {
        return {
          milestone: "system",
          title: "Finish the design system",
          detail: "A design system draft is waiting. Approve it so screens and tasks use its look and component library — or skip it.",
          cta: "Open design system",
          href: `/projects/${p}/design-system`,
          secondary: input.ux.hasDraft ? { label: "Skip — finish the screens", href: `/projects/${p}/ux` } : skipSystem,
        };
      }
      if (input.ux.hasDraft && !input.ux.approved) {
        return {
          milestone: "screens",
          title: "Finish the UI reference",
          detail: "A screen draft is waiting. Approve it so the tasks follow its layout — or skip it and cut the tasks now.",
          cta: "Open UI reference",
          href: `/projects/${p}/ux`,
          secondary: { label: "Skip — generate tasks", action: "?/generateTasks" },
        };
      }
      // The look and the screens are easiest to agree on before tasks are cut from them.
      if (!system.approved && input.designSystem && !uxStarted) {
        return {
          milestone: "system",
          title: "Choose a design system",
          detail: "The look and the component library every screen and task uses. Optional — skip it and go on to the screens.",
          cta: "Choose design system",
          href: `/projects/${p}/design-system`,
          secondary: skipSystem,
        };
      }
      if (!screensDone) {
        return {
          milestone: "screens",
          title: "Sketch the key screens",
          detail: "Mockups of the key screens; the tasks then follow their layout, elements and flow. Optional — skip it and cut the tasks now.",
          cta: "Sketch the screens",
          href: `/projects/${p}/ux`,
          secondary: { label: "Skip — generate tasks", action: "?/generateTasks" },
        };
      }
      return {
        milestone: "tasks",
        title: "Break the design into tasks",
        detail: "Each task becomes a bounded work order: scope, acceptance criteria and the commands that prove it works.",
        cta: "Generate tasks",
        action: "?/generateTasks",
      };
    }
    if (!tasksLive && drafts.length > 0) {
      return { milestone: "tasks", title: `Approve ${drafts.length} draft task${drafts.length === 1 ? "" : "s"}`, detail: "Draft tasks can't be picked up by an agent yet. Approving makes them ready to work on.", cta: "Review tasks", href: `/projects/${p}/tasks` };
    }
    if (!started && ready.length > 0) {
      const first = ready[0]!;
      return { milestone: "build", title: `Hand ${first.key} to your coding agent`, detail: `"${first.title}" is ready. Its work order tells an agent exactly what to change and how to prove it.`, cta: "Open work order", href: `/projects/${p}/tasks/${first.id}` };
    }
    if (!built) {
      if (review.length > 0) {
        return { milestone: "build", title: `Review ${review.length} submitted task${review.length === 1 ? "" : "s"}`, detail: "An agent finished and attached its evidence. Your review moves the work forward.", cta: "Review tasks", href: `/projects/${p}/tasks` };
      }
      const open = live.filter((t) => t.workflowStatus !== "DONE").length;
      return { milestone: "build", title: "Track the build", detail: `${open} of ${live.length} tasks still open. Agents claim, run and submit them; the board updates live.`, cta: "Open board", href: `/projects/${p}/board` };
    }
    if (!released) {
      // Tell the truth about the release check: features with gaps need fix
      // tasks, unchecked ones need a check, and only passing ones can be marked.
      const open = input.features.filter((f) => f.status !== "COMPLETE" && f.status !== "CANCELLED");
      const gaps = open.filter((f) => f.checked && !f.canComplete).length;
      const unchecked = open.filter((f) => !f.checked).length;
      const ready = open.filter((f) => f.canComplete).length;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      if (gaps > 0) {
        return { milestone: "release", title: `Fix the gaps in ${plural(gaps, "feature")}`, detail: `The release check found work that doesn't fully meet the requirements yet. Turn each finding into a fix task, then check again.${ready ? ` ${plural(ready, "feature")} can be marked complete meanwhile.` : ""}`, cta: "Review the gaps", href: `/projects/${p}/convergence` };
      }
      // No verdicts to go on (no features yet, or the check couldn't be read):
      // point at the release check without inventing a count.
      if (unchecked > 0 || ready === 0) {
        const what = unchecked > 0 ? `Check ${plural(unchecked, "feature")} against the approved requirements.` : "The release check compares the built work with the approved requirements.";
        return { milestone: "release", title: "Run the release check", detail: `Every task is done. ${what}`, cta: "Open release check", href: `/projects/${p}/convergence` };
      }
      return { milestone: "release", title: `Mark ${plural(ready, "feature")} complete`, detail: "The release check passed. Marking a feature complete records that the built work matches its requirements.", cta: "Open release check", href: `/projects/${p}/convergence` };
    }
    return { milestone: "release", title: "Every feature is complete and verified", detail: "The built work matches the approved requirements. New work starts with a new requirement.", cta: "Open release check", href: `/projects/${p}/convergence` };
  })();

  // The current chapter is the one the next action belongs to — so the
  // number, the highlighted chapter and the button always agree. (It used to
  // be the first unfinished chapter: a waiting optional draft kept the rail on
  // "step 6" while the button already said to hand a task to an agent.)
  const finished = !input.unavailable?.length && raw.every((m) => m.done || (m.optional && !m.draft));
  const nextIndex = finished ? -1 : raw.findIndex((m) => m.id === next.milestone);
  const milestones: Milestone[] = raw.map((m, i) => ({
    id: m.id,
    n: i + 1,
    label: m.label,
    href: m.href,
    optional: m.optional,
    blurb: BLURB[m.id],
    summary: input.unavailable?.includes(m.id) ? "Status unavailable — reload" : m.summary,
    state: input.unavailable?.includes(m.id) ? "current" : m.done
      ? "done"
      : (m.id === "screens" && screensSkipped) || (m.id === "system" && systemSkipped)
        ? "skipped"
        : i === nextIndex
          ? m.draft
            ? "draft"
            : "current"
          : m.draft
            ? "draft"
            : "todo",
  }));

  return { milestones, next, step: finished ? raw.length : nextIndex + 1, total: raw.length, finished };
}
