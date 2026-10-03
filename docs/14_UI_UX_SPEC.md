# UI / UX Specification

## 1. Product UX principle

The interface is **simple at the surface, structured underneath**.

Before a project has a plan, it should feel like a guided technical planning flow, not Jira, an ERP dashboard, or a dense control-plane console.

Canonical visual reference: `25_FRONTEND_DESIGN_SPEC.md` + `frontend_reference.html`. The implemented UI is built on daisyUI 5 (light and dark); `DESIGN.md` at the repository root is the record of the app's own design system.

## 2. Primary UX phases

```text
Discover → Define → Build
```

Detailed product flow:

```text
High-Level Idea
  ↓
Adaptive Discovery
  ↓
Requirements Baseline
  ↓
Technology Preference
  ↓
High-Level Plan
  ↓
Detailed Documentation
  ↓
Atomic Tasks
  ↓
Agent Work Order / Execution
```

The UI reveals deeper detail only when the user needs it.

### Implemented journey (9 milestones)

`apps/web/src/lib/journey.ts` derives every milestone from real project state (never from a "seen" flag):

```text
Discovery → Requirements → Stack → Technical design → Design system (optional)
  → UI reference (optional) → Tasks → Build → Release
```

- Milestone states: `done`, `current`, `draft`, `todo`, `skipped`.
- Optional steps are labelled "optional"; once tasks exist without them they show "skipped".
- After the technical design the next step runs **design system → UI reference → tasks**: each optional step is the primary action until it is approved or skipped, with a "Skip —" secondary that moves on to the next one ("Skip — sketch the screens", then "Skip — generate tasks"). The design system counts as skipped once the screens have started without it; a project with no visual interface goes straight to tasks. A waiting draft of either is finished first.
- Every planning page whose document is approved (requirements, stack, technical design, design system) shows the next step as a card in its body (`ChapterNextStep`); the UI-reference canvas has no room for one, so once its screens are settled the header's next-step button becomes its primary button. On the page a step's skip leads to, the header does not point back.
- The Release step is derived from real release-check verdicts: gaps to fix, run the check, or mark N features complete.
- Without an AI model for design, the design step points to the manual editor instead of "Generate".

## 3. Global shell

During initial planning:
- no permanent left sidebar;
- compact product/project identity;
- compact phase indicator;
- Documentation / repository / settings actions;
- no monetization-tier UI.

After planning exists, a project-local secondary navigation may expose:
- Plan;
- Docs;
- Tasks;
- Runs;
- Bugs;
- Convergence;
- Settings.

This project navigation must not dominate the initial idea/discovery experience.

Implemented shell:
- header with project breadcrumb, command palette (`Ctrl/⌘+K`; searches sections, tasks, requirements, bugs and UI-reference screens) and a light/dark theme toggle. The theme follows the system until the user picks one; the choice is pinned on `<html data-theme>`, stored in `localStorage` (`sdd-theme`) and applied before first paint;
- project tabs: Plan · Docs · Tasks · Board · Bugs · Convergence (Stack, Design system and UI reference pages count as Docs);
- `NextStepBar` in the project tab row on every project page: exactly one next step ("Step n of 9", title, one sentence, one action, optionally one secondary detour). It takes no height of its own: the row shows "n/9 · title" and the primary action, and a popover holds the sentence, the secondary detour and the journey. The Plan page shows the same step as a full panel with the `JourneyRail` (daisyUI `steps`). A generation started from any bar (Generate design / Generate tasks) is shared by every bar of the project: while it runs the action is disabled everywhere, and when it finishes the user is taken to the result only if still on the page where they pressed it — otherwise the data refreshes and the bar offers "Open it".
- the command palette's project index is kept for 60 s and dropped whenever the app's data is invalidated; a failed load is never kept.
- signed out, every page except sign-in, CLI authorization, health and logout redirects to `/login?next=…`.

## 4. High-level idea screen

Desktop reference composition:

```text
What happens next / short explanation   Idea composer
```

Minimum input:
- project name (may be inferred/proposed after idea entry);
- high-level idea;
- optional constraints/reference.

Primary action: `Mulai discovery`.

Do not ask for technology before discovery readiness.

## 5. Discovery

Default: **one primary high-impact question per screen/step**.

Show:
- question;
- why it matters when useful;
- text input or answer chips;
- `I don't know — recommend`;
- `Skip / use assumption`;
- compact progress/readiness;
- small `Already understood` facts/constraints summary.

Do not show a long static questionnaire by default.

## 6. Discovery readiness

Readiness is not a fake percentage. Show blocking/accepted assumptions clearly.

Example:

```text
Ready to define
✓ Product problem
✓ Primary user
✓ Main workflow
! Offline behavior accepted as assumption
○ SSO unknown — non-blocking

[Continue]
```

## 7. Requirements

Keep the first view concise:
- Summary;
- Actors;
- Core workflows;
- MVP scope;
- key acceptance criteria.

Advanced sections are progressively revealed:
- all FR/NFR;
- edge cases;
- assumptions;
- exclusions;
- revision diff.

Actions:
- edit;
- AI refine;
- compare revision;
- approve.

When no AI model is bound, requirements and the technical design are written in manual editors (`/projects/{id}/docs/requirements/edit`, `/projects/{id}/docs/design/edit`) that save a draft revision like a generated one.

## 8. Technology preference

Two top-level modes only:

```text
[ Use AI recommendation ] [ Choose manually ]
```

Manual mode shows compact technology rows. Each row can be user-selected or individually ask AI for a suggestion.

Suggested categories:
- Frontend;
- Backend/runtime;
- ORM/database;
- Deployment;
- additional layers only when requirements need them.

AI recommendation must show a short rationale/tradeoff.

## 9. High-level plan

The first planning visualization explains scope and relationships, not runtime task state.

Example conceptual structure:

```text
Project Intent
  ├── Feature / capability A
  │    ├── sub-capability
  │    └── sub-capability
  ├── Feature / capability B
  └── Feature / capability C
```

Use an original tree/column/canvas composition. Do not copy external reference node placement.

Controls may include:
- fit;
- zoom;
- outline fallback;
- open feature detail.

Mobile switches to structured outline/cards.

## 10. Documentation workspace

Implemented Docs tabs (links; the URL `?tab=` is the state):
- Requirements;
- Tech stack;
- Technical design (data model, API contracts, state machines, tests and deployment are sections of it). Like requirements, a draft is approvable whenever it is the latest version — also v2 and later: the "Approved · vN" badge shows what is in use next to "Approve design vN+1", and a notice says vN stays in use until vN+1 is approved;
- Design system;
- UI reference — this tab opens the canvas at `/projects/{id}/ux` (the only view of the UI reference); `?tab=ux` redirects there.

Do not render every document at once.

### Design system (optional, after the stack)

Screen `/projects/{id}/design-system`, no AI call:
1. Starting style — gallery of 14 generic presets (each light + dark, all WCAG AA).
2. Component library — picker with a "Recommended for your stack" badge derived from the locked stack.
3. Adjust — brand colour, font pair, radius, density, depth (surfaces), border width.

A live preview (light/dark, width toggle) and a contrast report update as values change; a palette that fails a contrast pair cannot be saved. Actions: Save draft → Approve design system. A panel lists what the coding agent receives (`docs/design-system/` via `sddctl ui pull`). A stack change marks the design system stale.

### UI reference (optional, after the design)

Screen `/projects/{id}/ux`:
- "How should the screens look?" — Neutral mid-fidelity (greys; focus on layout, content and flow) or With the design system (real colours, type and components, light and dark; disabled until a design system is approved, preselected once one is).
- "How many screens?" — Let the AI recommend (it states the count and why) or Set the number myself (1–12, never exceeded).
- Optional guidance ("include / leave out ...", max 1,000 characters).
- On a draft: add a screen (name, purpose, key elements), remove a screen (confirmation; the last screen cannot be removed), "Draw all screens" (one AI call per screen, "Drawing n of N…"), redraw a screen with a change instruction, approve.
- The reference shows its fidelity badge ("Neutral" or "Design system vN"), the requested or recommended count with the AI's rationale, the current count after edits, and the person's guidance; "Plan the screens again" reopens count and guidance (it replaces the draft).

Once screens exist the page is a **canvas** (Figma/Stitch-like) filling the space under the tabs:
- every screen is an artboard the size of a real viewport — a desktop frame preset (Laptop 1280×800, Desktop 1440×900 by default, Full HD 1920×1080, QHD 2560×1440; remembered per browser) or Mobile 390×844, or Both — and longer only when its page scrolls, with a dashed line at the fold; overlays are drawn at their screen's viewport; each planned overlay (dialog, sheet, confirmation, state) its own artboard under its screen; arrows run from the button that opens an overlay and from links between screens; zoom, pan (drag the background, scroll; Ctrl+scroll zooms), minimap, fit (Shift+1). It opens on the first screen.
- Tools: Select (V), Hand (H), Comment (C). Hover outlines an element; click selects it; Esc selects its parent; double-click (or Enter) edits text in place.
- Layers panel: the artboards, and the component tree of the one in focus, named by role ("Table · 6 columns", "Primary button · Create project").
- Inspector: for an element — its role, the component it becomes in the chosen library, its text, "Edit text", "Change this part with AI" (only that element is redrawn; undoable), "Link to a screen", "Comment on this element" and its comments; for a screen — purpose, layout, requirements, must-show list, overlays, checks (HTML lint and the render check at phone and desktop width; "Check again" re-checks without an AI call; "Fix … with AI" redraws with the blocking findings as the instruction), comments, "Redraw with this change", "Apply N open comments with AI", "Undo: …", History (every kept version — at most 5 — with what changed after it and when, each with Restore; restoring keeps the current version in the list, so it can be taken back) and remove.
- Play: a full-screen prototype in the colour mode shown on the canvas; links switch screens, the button that opens an overlay shows it, any button in an overlay closes it, and a `<summary>` opens its `<details>` (the phone menu, a dropdown) as it would in the product.
- Keyboard shortcuts act on the canvas only: not while a page control (button, link, select, summary) has focus, and not while a dialog (Add screen, Plan again, Play) is open. Double-clicking inside text being edited selects a word, as usual.
- Edits are made against the version shown: a save, undo or restore of a screen that changed meanwhile (another tab, an AI change) is refused, the canvas says "The screen changed — reloaded" and shows the stored version. A text edit is saved only from a mockup currently on the canvas showing the current version; while a screen reloads the edit is refused with a message. "Plan again" and "Revise" are disabled while a canvas change or a drawing is in flight.
- Comments follow their element when a screen is redrawn or edited (by the element's text); a comment whose element is gone reads "element no longer exists".
- Mockups stay inert: iframes with `sandbox="allow-same-origin"` and no `allow-scripts`, plus the CSP (also written into every stored screen, so pulled files stay inert); the server stores only allowlisted, re-serialized HTML; the canvas reads their DOM from the page side. An approved reference can be inspected but not edited (Revise starts a new draft).

## 11. Atomic task planning

Default view: simple task list/table.

Each row:
- ID;
- title;
- feature/module;
- readiness/workflow state;
- hardness;
- open action.

Advanced views:
- task DAG;
- Kanban;
- parallel candidates.

Draft actions:
- edit;
- split;
- merge;
- regenerate;
- approve plan;
- add render check (a screen task that lint holds back without one).

A draft row names its first failing readiness check, so a stuck draft says why.

## 12. Execution Kanban

Optional advanced view:

```text
READY | RUNNING | VALIDATING | REVIEW | REWORK | BLOCKED | DONE
```

Drag-and-drop, if added, cannot bypass legal domain transitions.

## 13. Task detail / Agent Work Order

This is intentionally the most detailed page.

Sections:
- objective;
- traceability;
- dependencies;
- allowed/forbidden scope;
- constraints;
- verification;
- deliverables;
- stop conditions;
- generated prompt;
- active/latest run;
- timeline/evidence;
- review.

Prompt actions:
- Copy Standalone;
- Copy Connected CLI;
- Copy MCP.

## 14. Local execution setup

```text
1. Install sddctl   (curl -fsSL <api-url>/api/v1/cli/install.sh | sh — served by the control plane)
2. sddctl login
3. Link repository
4. Optional later: install sdd-agent daemon
```

The Machines page shows the install command the server returns (`GET /api/v1/cli`), with the PowerShell one beside it.

Connected-machine detail is an advanced settings/execution area, not onboarding noise.

### Machines page (`/machines`)

- Signed out → redirect to `/login`; an API failure is shown as an error, never as an empty list.
- Lists the user's machines (status, platform, last seen) and, per machine, its **linked repositories**: project key and name, local path, and how runs are reviewed.
- Each active link has a two-option control (daisyUI radios + Save), with one short explanation above the list:
  - **Human review** — every run waits for a reviewer before its task is done (mode `MANUAL`; a legacy `ASSISTED` link also shows here).
  - **Auto-approve runs whose required checks pass** — the agent's passing evidence closes the task without a reviewer; high-risk (HUMAN_REQUIRED) tasks still wait for one; the server may also hand the machine's `sdd-agent` the next ready task (mode `AUTO_RUN`).
- Only project admins can change it (`PATCH /agents/repo-links/{id}`, browser session, audited); others see the current choice read-only with "Only an admin of <KEY> can change this." The CLI cannot turn auto-approve on.

## 15. Active run

Show only useful execution telemetry:
- task;
- executor;
- elapsed time;
- heartbeat;
- current milestone;
- latest meaningful events;
- tests;
- cancel action when authorized.

Avoid terminal-log spam in the primary UI.

## 16. Review

Review puts together:
- task contract;
- acceptance criteria;
- execution summary;
- diff/commit reference;
- test evidence;
- findings.

For a task that builds a screen, a "Check the screen" checklist sits above the decision: the render check's result (or a warning that there is none) and where its screenshots are, then per screen — inside the app shell (or deliberately outside it), each key element, regions/order/copy as in the mockup at 1280 and 360 px, design tokens only.

Actions:
- Approve;
- Request Changes;
- Create Bug.

## 17. Bugs

Bug UI captures:
- current behavior;
- expected behavior;
- unchanged behavior;
- reproduction;
- severity;
- linked task/run/feature/criterion.

## 18. Convergence

Convergence is a completion gate, not a dashboard decoration.

Show:
- criterion coverage;
- blocking findings;
- open blocking defects;
- stale artifacts;
- generated corrective tasks.

The release check page orders features by the work left: gaps to fix first, then ready to mark complete, then not checked yet. Completed features fold into one row (a feature completed during the visit stays visible). Each feature is judged against its own linked requirements. "Mark feature complete" asks for confirmation in a dialog first. If the API cannot be read, the page shows the error instead of "no features".

## 19. AI provider settings

Outside the planning wizard, expose two separate levels:

### Provider Connections
- OpenAI;
- Anthropic;
- Gemini;
- OpenAI-compatible;
- generic custom HTTP;
- Local CLI (Claude Code / Codex) — choose the CLI and where it runs: "This server" (disabled with an explanation unless the operator set `SDD_ENABLE_LOCAL_CLI=true`) or one of the user's own machines, each shown with online / installed / signed-in status. No key is stored; the CLI uses its own sign-in.

### AI Profiles / Role Routing
- provider connection;
- model;
- parameters;
- role assignment;
- project override.

Never display stored provider secret values after save. Editing a connection's base URL to another origin (host, scheme or port, or to/from the provider default) makes the API key field required: the stored key is not sent to a new host.

"Fetch models" and "Test & fetch models" always end: a network failure, an upstream refusal or an empty catalogue is reported on that connection instead of a spinner or "0 models".

## 20. Responsive behavior

Mobile is first-class for:
- idea input;
- discovery;
- requirements review;
- task status/review.

Desktop-first interactions:
- large planning canvas;
- dependency graph editing;
- dense diff/evidence inspection.

Provide structured fallbacks rather than shrinking graphs until unreadable.

## 21. Visual status rules

Status color is supplemental. Text/icon remain authoritative.

Do not encode critical meaning through color alone.

Status text colours pass WCAG AA in both light and dark themes (the raw daisyUI status colours do not, so the app mixes them with the base text colour). Inline banners use one `Notice` component (daisyUI `alert`).

## 22. Empty/error/loading states

Every AI generation flow has:
- running;
- failed;
- retry;
- partial result when safe;
- manual edit fallback.

Every AI action shows `AiProgress`: a spinner, an estimate ("about a minute"), elapsed time after 30 s, announced through a polite live region.

A provider failure must not trap the user's planning data.

## 23. Originality and open-source UI rules

- External screenshots are UX inspiration only.
- Do not pixel-copy branding, layout, typography, navigation, node placement, card composition, or copywriting.
- No pricing-tier/upsell controls in the reference core UI.
- Prefer project-defined tokens/components from `25_FRONTEND_DESIGN_SPEC.md`.
