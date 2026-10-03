# DESIGN.md — Agentic SDD Control Plane

> Recorded from the built world (web app in `apps/web`), not from intention.
> Product truth lives in [PRODUCT.md](PRODUCT.md); the token source of truth is
> `apps/web/src/app.css`.
>
> **Documentation review 2026-10-03, not fresh visual/accessibility testing.** Where this document and `app.css` disagree,
> `app.css` wins — see "Token source of truth" below.

## World

**Thesis:** a focused technical workspace that begins simple and reveals power
progressively. Guided wizard at the surface, evidence-dense workbenches
underneath. No dashboard before a plan exists, no Jira density, no chat-everywhere.

**Ground:** the app is built with **daisyUI 5** on Tailwind CSS v4, with two custom themes
defined in `app.css`: **`forest`** (dark, the default and the brand's home) and **`forest-light`**
(warm paper). Built-in themes are switched off (`themes: false`). The theme button in the sidebar
pins either one on `<html data-theme>` and remembers it per browser (`app.html` applies it before
first paint and maps the older stored `light`/`dark`/`fantasy`/`abyss` values). Page canvas
`base-200`, cards and bars `base-100`, wells `base-300`; hairlines `line`; overlays add a soft shadow.
The look follows the speclineyouridea design system (brand: speclineyouridea).

**Everything is daisyUI:** `btn` (primary / ghost / outline / sm / square), `input`, `select`
(native `<select>`), `textarea`, `checkbox`, `radio`, `range`, `badge`, `alert`, `card` (every
bordered surface), `modal` (every dialog, on the native `<dialog>` via `ui/Modal.svelte`),
`dropdown` (popovers, on the popover API via `ui/Dropdown.svelte`), `tooltip`, `tabs tabs-border`
(the spine), `menu` (the phone chapter list, the command palette results, the Layers tree),
`list` (project and screen rows), `timeline` (the notebook's chapters), `collapse`, `steps`,
`navbar`, `table`, `loading`, `join`, `kbd`, `progress`. There are no app component classes
and no headless UI library; what daisyUI has no class for is written with Tailwind utilities.
The only custom CSS left is `.prose-doc` (rendered Markdown), the `settle` keyframe, and the
xyflow canvas (artboard frames, fold line, flow colours mapped onto daisyUI variables).

**Colour:** daisyUI's semantic colours plus a few brand tokens (`app.css`, per theme):
`line` for every hairline (base-300 is a well, darker than the surfaces, so a base-300 border
disappears), `line-control` (3:1) for edges that are a control's only boundary, `primary-ink` for
green as text (the same as primary in forest, a deep green in forest-light, where the bright green
is 2.6:1 on paper), and the status text tokens `mint`, `sky`, `warn`, `violet`, `danger` with their
`-soft` tints, all AA as text in both themes. `primary` is the CTA fill with black
`primary-content`; green is scarce and only means go / proven. A headline gets a green word
only when it states a settled good outcome (done, complete, approved, locked, online) — never
as decoration, never on a count of work still to do. Task status follows the same rule: Ready
is neutral and hollow (nothing done yet), only Done wears mint and the check mark.

**Type:** Geist Variable for both display and body, Fira Code Variable for task keys,
paths, and commands. Role scale: 12 label/metadata · 13 secondary · 14 body · 16 card
title · 20 page title · 24 wizard/section display · 28–32 first-run display. Nothing
renders below 12px. On phones form fields render at 16px (no iOS focus zoom).

**Geometry:** daisyUI's radius tokens — `rounded-field` (2rem: controls and badges are pills),
`rounded-box` (1rem: cards and overlays), `rounded-selector` (1rem). Flat (depth 0): structure is
carried by `line` hairlines and base steps.

**Token source of truth:** `apps/web/src/app.css` (the two `daisyui/theme` blocks and the
`@theme inline` text tokens). This document must be updated alongside any token change there.

## Components

- `AppSidebar` — the app's one navigation: a 256px sidebar from lg up, a drawer behind a menu
  button on smaller screens. Outside a project: Today and the projects. Inside one: the project,
  the Notebook and the nine chapters as a vertical "spec line" (the logo's motif) with a state
  node each — done (check on mint), draft awaiting approval (pen, warn), next up (number on
  primary with a soft ring), not started (number, `line-control` ring), skipped (–); the page's
  chapter is `aria-current="page"`. Search (Ctrl K / ⌘K), AI providers, Machines, the account,
  the theme button and sign-out live in it. State comes from `lib/journey.ts`, never a "seen" flag.
  Project pages add a slim bar above the content: breadcrumb (project › page) and the NextStepBar.
- `NextStepBar` — the project's one next step ("Chapter n of 9 · Chapter", title, one sentence,
  primary + optional secondary action). On every project page except the Notebook it is the
  `inline` variant at the right end of the spine ("Next:" + a small outline button that names the action; the page keeps the one green button),
  whose popover holds the sentence and the actions; on phones it is a fixed bottom action bar
  (title + an outline action in thumb reach; tapping it opens the step as a bottom sheet with the primary action) — so the pages below keep
  their height. The Notebook carries it inside the open chapter. It replaces one-off "Next:"
  notices that a reload lost; when the user is already on the target page it says "you're
  here" and drops the button; on the page a step's skip leads to (the screens, after
  skipping the design system) the bar does not point back. On the UI-reference canvas,
  once its screens are settled, the inline button is solid (`prominent`): the canvas has no
  button of its own.
- `ChapterNextStep` — the NextStepBar `panel` in a bordered card in the body of a planning
  page whose document is approved (requirements, stack, technical design, design system):
  the page's one green button once its own work is done. Hidden when the next step is the
  page's own chapter, during build and release, and on phones (the bottom bar has it). The step number is the chapter the next action belongs to, so
  the spine and the bar never disagree. The release step tells the truth: gaps to fix, features
  still unchecked, or features ready to mark complete — never a count it can't back. AI actions
  started from it land on what they made (`goto` to the design or task list).
- `DecisionReceipt` — every decision other work builds on (approve requirements, design, design
  system, UI reference; lock the stack) opens a receipt first: what becomes the baseline and what it
  replaces, what it unlocks, which chapters that already hold work go stale (the API's downstream
  order), and that there is no un-approve — a new version is the way back. "Not yet" / "Approve vN".
- `BuildViews` — the Build chapter's two views, Board | Bugs, as a `join` with the open-bug count.
- `AiProgress` — the one loading voice for every AI call (discovery, requirements refine,
  stack, design, tasks, UI reference, release check): spinner, what is happening, a plain
  estimate ("about a minute"), then an elapsed counter after 30s; `role="status"`, announced
  in 30s steps. The triggering button disables its siblings and says what it is doing.
- `Notice` — the one inline banner, a daisyUI `alert`: success / error / warn / info, fixed
  size, padding and icon, AA tone colours; errors are `role="alert"`, the rest `role="status"`. Replaced ~37 hand-built banners;
  new banners use it, never ad-hoc tinted divs.
- `StatusBadge` — status icon + label; colour is supplemental, text authoritative.
- Surfaces: daisyUI `card` with a `base-300` border on `base-100` (or `base-200` for a flat inset) — never nested.
- Buttons: daisyUI `btn` / `btn-primary` (primary fill, primary-content text) / `btn-ghost` /
  `btn-outline` / `btn-sm` / `btn-square`; segmented choices are a `join` of `btn btn-sm join-item`
  with `btn-active`. On coarse pointers buttons are ≥44px tall (`.btn-sm` also ≥44px wide) and
  badges used as buttons, radios and select triggers ≥40px.
- Inputs: daisyUI `input`, `select`, `textarea` (full width unless sized), `checkbox`, `radio`, `range`.
- Tags and statuses: daisyUI `badge badge-sm` with the AA tone utilities (`text-mint bg-mint-soft …`).
- Markdown documents render server-side through `renderMarkdown(…, {nested:true})` into
  `.prose-doc`: headings shift one level under the page's h1/h2, lines cap at 72ch, tables
  scroll inside their own box.
- Headings and labels are sentence case; no uppercase tracked mini-headings anywhere.
- Browser chrome themed: light selection, thin scrollbars, visible focus rings,
  `prefers-reduced-motion` honoured.

## Surfaces

- **Start / Today** (`/`): first run (no projects) — left headline + vertical 4-step path
  (connect AI → describe idea → approve the plan → first work order) whose step 1 is the primary
  action while AI is not configured; right composer card with a quiet "Start without AI instead".
  Returning users get **Today**: one hero card with the most recently touched project's next step
  (from its journey), "Waiting on you" (other projects blocked on the user: tasks to review, drafts
  to approve, stack to lock, discovery to answer), then every live project with checkboxes to
  archive (with Undo) and an "Archived" disclosure to restore. Above the list Today proposes clutter
  to clear — older copies of a project name (keeps the newest), projects untouched for two weeks —
  and "Select them" only ticks the boxes; archiving stays the user's click. The composer is behind "New project".
- **AI settings**: once AI works, the page leads with "Your AI" (model via provider, which steps
  use it, steps without a model) with Change / Add a provider; connections, profiles and role
  routing sit behind "Show connections, profiles and role routing".
- **Discovery**: an interview. Left: one readiness meter (answers toward the API's one gate,
  `DISCOVERY_READY_AFTER_ANSWERS` = 15, or sooner once the core topics are covered; it never
  moves backwards), then one question card — suggestion chips answer in one tap (a "Recorded:
  … Change" line follows), free text below, and "Not sure?" shows the default it would assume
  before recording it. Right: the live Brief — every answer, editable in place until discovery
  is finished (re-answering replaces the fact, never calls the AI), the assumptions, and the
  inferred facts collapsed. Finished discovery shows the same brief read-only.
- **Stack**: two-mode segmented selector (AI recommendation / manual),
  technology rows with per-row AI assist, compatibility findings, approve baseline.
- **Notebook** (`/projects/[id]`): the idea (clamped, expandable) then the chapters as one
  vertical list on a thread. The chapter the next action belongs to is open — a primary-bordered
  panel with what it holds and the next step; done chapters are one line with where they stand
  ("v1 approved · 15 requirements, 7 P0"), chapters to come say what they will hold. Features
  follow, with states from the release check ("Ready to mark complete", "Gaps to fix", "Built —
  awaiting release check"). The Start page's project labels ("Building · x/y tasks", "Release
  check · x/y verified", "Complete") come from real task and feature counts.
- Every project page has a visible h1 naming its chapter; Discovery lives inside the project at
  `/projects/[id]/discovery` (the old `/new/discovery/[id]` redirects), Stack opens locked when
  a version is locked and only revises on request.
- **Requirements**: the document folds per requirement (`foldRequirementSections`: each
  "FR-001 — …" heading becomes a closed `<details>` with a monospace priority badge), with Expand
  all / Collapse all. The side index lists each requirement (key, priority, title, criteria count)
  and opens + scrolls to it; while searching it also shows the matching criteria.
- **UI reference canvas**: one toolbar row at 1440 — panels, tools, one "View" button naming the
  current device, frame and colour mode (the three controls live in its popover), zoom, then the
  page's actions. The canvas is a focusable region: ] [ step through screens, arrows pan.
- **Hardness** is always shown with its word (trivial, easy, moderate, hard, very hard) and a title
  explaining it (`hardnessTitle` in labels.ts): how hard the work order is for an agent, scored
  1–5 from its risk factors.
- **UI reference on phones**: the canvas needs a wider screen, so phones get the screens as a
  numbered list (name, purpose, drawn or not); a row plays the prototype from that screen.
- **Hand-offs**: every approval confirms what happened in a notice (requirements/design
  approved, "Stack locked — version N", design/tasks generated, discovery complete) and the
  NextStepBar names the step it unlocks. Stack and UI reference live inside the project
  workspace (`/projects/[id]/stack`, `/projects/[id]/ux`; the old `/new/…` addresses redirect).
- **Design system** (`/projects/[id]/design-system`, optional, after the stack is locked):
  editor with three steps — starting style (14 generic presets adapted from open-design,
  each with light and dark palettes that meet WCAG AA), component library (ordered by fit
  to the locked stack, first one marked "Recommended for your stack"), and adjustments
  (name, brand colour kept readable in both modes, fonts, radius, density, surfaces, border
  width) — beside a live, sandboxed kit preview with light/dark and desktop/mobile toggles.
  A contrast notice under the controls reports every failing pair; saving refuses them.
  Save draft → Approve; the approved view shows the summary and the files
  `sddctl ui pull` writes into `docs/design-system/`. Mockups and previews never load
  fonts: stacks end in system fallbacks.
- **Docs**: link-based switcher (URL is the state) over five spec artifacts — Requirements,
  Tech Stack, Technical Design, Design system, UI reference — each with its version; approve + AI refine and
  revision history; the stack tab links to "Change stack"; the UI reference tab shows the
  version in use next to any newer draft, the screen list and a sandboxed preview. Empty
  states offer the real way forward — including "Write them yourself" / "Write it yourself",
  primary when no AI is connected. Manual editors: `docs/requirements/edit` (requirements with
  acceptance criteria and verification type, quality needs, workflows) and `docs/design/edit`
  (gated on approved requirements + locked stack); both save a draft and return to the tab.
  Footer lists the AI models in use.
- **Tasks**: readable table first (key, title, status, hardness, approve);
  progressive disclosure for dependency checks. A draft row names its first failing
  readiness check (warning icon); a screen task that lint holds back for want of a render
  check gets "Add render check" in its row menu.
- **Work order** (task detail): contract sections (objective, ACs, scope
  expected/forbidden, verification, stop conditions), runs + test evidence +
  event timeline; prompt panel with three copy modes; review rail with
  approve / request-changes / manual-run fallback. For a task that builds a screen the
  decision card opens with "Check the screen" (`ScreenReviewChecklist`): the render check
  passed (mint check + where the screenshots are) or a warning that there is none / no
  passing result, then per screen the rubric — inside the shell, each key element, regions,
  order and copy as in the mockup at both widths, tokens only.
- **Board**: kanban over legal transitions (6 columns) with a "Needs attention" strip, a done
  summary, a list layout on phones and a live badge (Connecting / Live / Updates paused +
  Reconnect) — the only surface subscribed to the stream.
- **Bugs**: behaviour-triplet reporting with confirm → fix-task (not an AI call).
- **Release check** (`/convergence`): features ordered gaps → ready → unchecked, finished ones
  folded into "N features complete and verified"; each card has one verdict pill and says why
  a feature can't complete yet. Judged per feature on its own linked requirements.
- **Discovery**: once finished it is a read-only summary with a link to requirements; it only
  asks the AI for the next batch while discovery is actually open.
- **Errors**: `+error.svelte` names 404 / 401 / 403 / 5xx in plain words with "Back to start"
  and "Go back"; sign-in and CLI authorize keep a safe `next` redirect.
- **Settings AI / Machines**: while AI setup is incomplete a 3-step strip (provider →
  model → use for planning) replaces the section sidebar and the page lands on the
  next unfinished step; the first profile can be bound to every role at once.
  Provider connections (write-only secrets), AI profiles, role bindings; connected
  machines + local setup steps, the first being the install command the server returns
  (`GET /api/v1/cli`: the CLI is served by the control plane, no repository checkout).

## Motion

Two authored moments: the focus-question card crossfades on change, and a feature
completed during the visit settles into its "Complete and verified" summary
(`.settle`, 320ms fade + 4px rise, once — on later loads the summary is static).
Progress bars move with `transform: scaleX`, never `width`. Everything else is
150–200ms colour transitions. Loading states use `AiProgress` for AI calls
and a spinning `Loader2` inside the triggering button for short actions; nothing relies on
entrance animation to be visible. Discovery's progress sweep animates `transform` only.
`prefers-reduced-motion` collapses all animation and transition durations except the
busy spinner, which keeps turning slowly because it is the only loading cue.

## Accessibility floor

Body text ≥4.5:1 on all surfaces; status never encoded by colour alone (icon +
label via `StatusBadge`); keyboard focus visible everywhere; forms have real
labels; empty, loading, and error states exist for every AI-driven flow with a
manual fallback (C17). Notices go through `Notice` (`role="status"`, failures
`role="alert"`). Every page has exactly one h1; project pages keep it as the first heading
(the next-step bar is an `<aside>` with a plain-text title). Icon-only controls and search
inputs carry accessible names.
