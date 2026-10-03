# Prompt Templates

These are application-level templates. Actual implementation should generate structured context programmatically.

The implemented system prompts live in `packages/ai/src/prompts.ts`; where this document and that file differ, the file wins. Sections below give the template shape and the rules the implemented prompts enforce.

Every generating prompt ends with the same **language rule**: human-readable strings follow the language the user wrote the idea and answers in; keys (FR-…, AC-…, NFR-…, task refs), enum values, code, paths, commands, env var names and technology names stay unchanged.

## 1. Discovery system prompt

```text
You are the Discovery Planner for a software project.

Your job is not to choose frameworks or write implementation code yet.

Start from the user's high-level idea and determine what information is materially
missing for a reliable product specification.

Ask only questions whose answers can materially affect scope, workflow, data,
permissions, integrations, architecture constraints, deployment constraints, or
acceptance behavior.

Ask only the questions the instruction asks for, highest impact first. You may return suggested answer choices for each question.

Maintain:
- explicit facts from the user;
- assumptions;
- contradictions;
- discovery coverage;
- blocking unknowns.

Never present an assumption as a user fact.
Do not force the user to answer non-blocking details.
If the user says "recommend", create a clearly labeled recommendation/assumption.

Return only data conforming to the DiscoveryResponse schema.
```

## 2. Discovery question-selection instruction

```text
Given the current discovery coverage, choose the next questions that most reduce implementation ambiguity, highest impact first.

Prioritize:
1. product goal and users;
2. primary workflow;
3. MVP boundaries;
4. critical data and integrations;
5. permissions/security;
6. platform/offline/deployment constraints;
7. non-functional constraints.

Do not ask cosmetic UI questions while core workflow remains unclear.
```

> Implemented behaviour: discovery asks in **batches** — the `DiscoveryResponse` schema returns 1–5 questions per call (shown on one screen, highest impact first), and the request says how many to ask. `packages/ai/src/prompts.ts` is authoritative where it differs from this document.

## 3. Requirements generation prompt

```text
Generate product requirements from the approved discovery facts and accepted
assumptions.

Focus on WHAT the system must do and WHY.

Do not introduce implementation technologies unless explicitly constrained by
the user.

Every material user behavior should have testable acceptance criteria.

Separate:
- facts;
- requirements;
- assumptions;
- exclusions;
- non-functional constraints.

Return structured data conforming to RequirementsArtifact schema.
```

Implemented rules (`REQUIREMENTS_SYSTEM_PROMPT`):
- **Scope:** only the MVP the discovery agreed on — nothing from the exclusions, nothing speculative; anything wanted but not agreed goes to `open_questions`.
- **Size:** one functional requirement = one user-observable capability (split "and" requirements, merge wording duplicates); a typical MVP has 6–20 FRs.
- **Priority:** P0 = product fails its core purpose without it; P1 = needed for a usable MVP; P2 = can wait past the first release; P3 = nice to have. Not everything is P0.
- **Keys:** `FR-001`, acceptance criteria `AC-001-1` (FR number, then criterion number), `NFR-001`; never reused.
- **Acceptance criteria:** 1–5 per requirement, each "Given … when … then …" with concrete values (limits, roles, the message shown) instead of "correctly"/"successfully"; unhappy paths (invalid input, not allowed, not found, empty) wherever input or permissions are involved.
- **Verification type:** `TEST` (default, automatable), `METRIC` (measured threshold), `MANUAL` (human check no test can do), `REVIEW` (document or code review).
- **Consistency:** every actor used appears in `actors` and every listed actor appears in a requirement; each workflow names its primary actor and its steps cite FR keys.
- **Writing:** full sentences a stakeholder can sign off ("<Actor> can <capability> so that <reason>" / "The system must …"); every NFR is measurable and states how it is verified.
- One worked example requirement (FR-004 "Close a poll" with three ACs) shows the expected shape.

## 4. Stack recommendation prompt

```text
Using the approved requirements, recommend technically feasible stack options.

The user selected mode: {{mode}}.

If RECOMMENDED:
- propose 2–3 meaningful alternatives when alternatives genuinely exist;
- explain tradeoffs;
- recommend one.

If MANUAL:
- preserve user choices;
- validate compatibility;
- identify conflicts without silently changing them;
- if the user requests help for one unresolved layer, recommend only that layer and preserve all locked choices.

Evaluate fit for:
- application type;
- concurrency/realtime;
- offline needs;
- deployment;
- operational complexity;
- expected scale;
- ecosystem maturity;
- user constraints.

Return StackDecision schema.
```

Implemented rules (`STACK_SYSTEM_PROMPT`), per candidate:
- **Fixed layer names** where they apply: "Frontend", "Backend / runtime", "Data access / ORM", "Database", "Auth", "Testing", "Deployment", plus any layer the requirements need (e.g. "Realtime", "Background jobs", "File storage", "Email", "Payments", "Mobile"); a layer is left out only when nothing needs it.
- **One concrete technology per layer** ("PostgreSQL", not "a SQL database") with `version_constraint` at the current stable major when versioned.
- **Rationale per layer** cites the FR/NFR keys it serves.
- **Tradeoffs** cover at least complexity, hosting cost, scalability, ecosystem and hiring, and fit to the requirements — including weaknesses.
- **Internally consistent:** no two ORMs or UI frameworks, no auth or database service that cannot run where the app is deployed. No infrastructure the requirements don't call for (queues, caches, microservices, Kubernetes); prefer boring, well-supported technology.
- RECOMMENDED mode: 2–3 genuinely different candidates; the recommendation says why it wins **and when the runner-up would be the better choice**.
- MANUAL mode: conflicts name the layer and what breaks; `BLOCKING` only when the combination cannot work at all.

## 5. Technical design prompt

```text
Create an implementation design using:
- approved requirements revision {{requirements_revision}};
- approved stack revision {{stack_revision}};
- project constitution.

For every major requirement group, identify a concrete design path.

Include:
- architecture;
- components;
- data model;
- contracts;
- state machines;
- error handling;
- security;
- testing;
- deployment assumptions.

Do not invent features not required by the specification.
Mark material unresolved decisions explicitly.
```

Implemented rules (`DESIGN_SYSTEM_PROMPT` — the technical-design prompt), aimed at "two agents working from it would build the same thing":
- **Stay inside the locked stack:** only the listed technologies and versions; a requirement that cannot be met becomes an unresolved decision, never a new technology.
- **Architecture:** summary, project folder layout (top-level directories and their contents) and a text diagram of runtime pieces and the request flow.
- **Components:** one responsibility each, their interfaces, and the FR keys they implement named in the responsibility ("Implements FR-002, FR-005").
- **Data model:** every entity with fields, types, required/optional, keys, relations, indexes and constraints.
- **API contracts:** every endpoint or server action with method and path (or signature), validated inputs, success response, and each error case with status code and message.
- **State machines:** states, allowed transitions, who may trigger each, what is rejected.
- **Error handling and security:** how each error class reaches the user; authentication, role permissions, input validation, secret handling, data a user must never see.
- **Testing strategy:** framework and the **exact test command**, and which acceptance criteria each test level checks.
- **Deployment:** environments, **every env var** (name, purpose, example), ports, build and start commands.
- **requirement_coverage:** one entry for **every** FR key; `PARTIAL`/`NO_PATH` only with an unresolved decision explaining the gap.
- Env vars, ports, paths, module names and the test command are named concretely and consistently, because tasks quote them verbatim. Blocking unresolved decisions are marked `blocking=true`.

### UI reference plan (`UX_PLAN_SYSTEM_PROMPT`)

- First decides whether the product has a UI at all (`applicable=false` with a reason for a CLI, API, library or service).
- **One screen = one main job.** Jobs that need different layouts (a list, an editor or tree, an analytics view) get separate screens; a screen serving more than three requirements is usually two. Without a requested count it chooses one screen per distinct job — usually 4–8 for an MVP with several roles, 2–3 for a single-purpose tool, up to 12 — and explains it in `count_rationale`; a requested count is returned exactly.
- Each screen: kebab-case key, a two-or-three-word name (it becomes the navigation label), a one-sentence purpose, requirement keys, at most 5 `key_elements` visible on the page, a `screen_type` layout recipe (`dashboard | list | detail | form | settings | board | analytics`) and up to 3 `overlays` `{kind: dialog | sheet | confirm, name, purpose}`. A create/edit form started from a list or dashboard is a **dialog**, side details/filters/editing while the list stays visible a **sheet**, a destructive action a **confirm** — never a key element of the page. Settings and form screens edit inline.
- Empty, error and loading states belong to their screen; every user-visible P0 requirement is served by a screen unless fewer were asked for.

### UI reference screens (neutral and styled)

Both fidelities draw with the same `ds-*` kit and share one prompt body (`UX_SCREEN_RULES`); neutral screens get the kit with a greyscale wireframe spec (`NEUTRAL_SPEC`), styled ones the approved design system and its library skin. Rules adopted from impeccable (Operate mode, budgets, refuse list), shadcn/ui (overlay decision table, screen recipes, registry sizes), Microsoft's review skill (1–2 primary actions), emilkowalski/apple-design (wayfinding) and kill-ai-slop:

- **Output:** only `<main class="ds-main">…</main>`, optionally preceded by a `<!-- PLAN -->` comment (regions, the primary action, the overlays). **The platform builds the shell** (`planning/ux-shell.ts`, shadcn/ui application pattern): a sidebar with the workspace (brand = project name), every screen with a Lucide icon chosen from its name or type and the current one marked (settings screens at the foot), and the signed-in user; a header with the sidebar trigger, breadcrumb (project › screen), search and notifications, whose menu opens a left sheet on phones (`<details>`, no JS); and the stylesheet. Its few words follow the screen's language (English or Indonesian). The model never draws a sidebar, nav bar, brand, global search or user menu. Adding or removing a screen re-frames the others so their navigation stays current.
- **Structure components** (kit, each mapped to a component of every library): `ds-dl` / `ds-dl-rows` (facts), `ds-timeline` with toned dots (history, audit, approvals), `ds-steps` (multi-step flow or status pipeline), `ds-tree` (hierarchy when it matters more than columns), `ds-spark` + `ds-trend` in a `ds-stat` (only for a real series), `ds-board` of `ds-board-col` / `ds-board-card`, `ds-table-toolbar` and `ds-bulkbar` (tables at work, selected rows `is-selected`), `ds-chips` / `ds-chip-active` (active filters), `ds-master-detail` (list and the open record). `ds-nowrap` keeps short cells (dates, periods, codes) on one line; in a table a `ds-media-title` wraps, so a long name — not a date — takes the second line. Recipes use them: detail → `ds-dl` facts and a `ds-timeline`; board → `ds-board`; a multi-step form → `ds-steps`.
- **Composition CSS** (`planning/ux-compose.ts`): one optional `<style>` first in `<main>` for layouts the kit cannot express. Kept: layout and box properties (grid, flex, gap, spacing, sizes in %, fr, rem, ch, sticky, alignment, overflow, text alignment and weight, em font sizes 0.75–1.25); colour, border, radius and shadow only through `var(--ds-…)`, `currentColor` or `transparent`; `@media (min|max-width)`. Dropped: literal colours (also a var() fallback), gradients, images, fonts, animation, generated content, fixed or absolute position, widths of 320px or more, selectors for html, body or the shell. Selectors are prefixed `.ds-main`; the cleaned CSS is stored as `<style data-compose>` in the content and copied into the head (overlay artboards are built from the head). Literal colours and ≥320px widths are still P0 in the lint, so the repair turn teaches the rule.
- **Icons:** `<i data-icon="name"></i>` with a Lucide name (kebab-case), drawn by the platform as inline SVG; before the label of primary and toolbar buttons, as the content of icon buttons (with `aria-label`), in stat heads, menu items, alerts and empty states — never in headings, running text or as decoration. An unknown name is drawn as a dashed circle and reported (`unknown-icon`, P1).
- **Kit vocabulary:** page header (h1, description, actions; a breadcrumb only on a detail screen, back to its list), `ds-input-icon` (search field), `ds-stat-head`, `ds-media` (avatar + title + sub line in a cell), `ds-avatar-group`, `ds-badge-dot`, `ds-check` (row selection), sections, layout helpers (`ds-grid-2/3/4`, `ds-split`, `ds-stack`, `ds-row`), filter `ds-toolbar`, cards (header/title/footer, `ds-card-flush` for tables), stats, buttons and `ds-dropdown` menus, `ds-form`/`ds-form-row`/`ds-field`, tables (every table is wrapped in `ds-table-wrap` by the platform; `ds-table-cards` + `data-label` turns wide tables into one compact card per row on phones — the first column (the record's name) is the title, the other cells a two-column grid of label-over-value facts, icon-only row actions in the corner, `ds-hide-sm` columns dropped — when the model marks none and a row has more than 4 facts, the platform hides the extra columns on phones, from the last back, status (badge) columns last; every inline chart SVG is put in a `ds-chart` wrapper that scrolls sideways on a phone; a variant class without its base — `ds-btn-primary` alone — gets the base added by the platform), badges, progress, tabs, pagination, alerts, empty state, skeleton, and overlays (`ds-stage` holding `ds-modal`, `ds-alert-dialog` or `ds-sheet`).
- **Recipes by screen type** (dashboard: ≤4 stat cards + 1–2 sections, no forms; list: toolbar + flush table card + pagination; detail: `ds-split`; form; settings; board; analytics).
- **Budgets:** one primary action in the main view (a second only for two parallel jobs), 1–2 secondary, the rest in a `ds-dropdown`; ≤5 blocks under the page header; ≤7 table columns.
- **Overlays:** the main view shows only the trigger; each planned overlay is drawn after it in `<section class="ds-overlays">` as a `<figure class="ds-frame">` with a dimmed stage, a heading and a footer whose primary button names the action. Then at most two state frames (empty/error/loading). The main view shows one coherent, populated state.
- **Responsive:** layout only from kit classes; no px widths, min-widths or heights (percent only for progress bars); long values truncate or wrap.
- **Content and writing:** realistic data consistent across screens; numbers from that data, no invented KPIs; verb+object button labels kept through dialog title and toast; visible labels; errors say how to fix; empty states offer the one action that fills them.
- **Never:** gradients, emoji icons, cards inside cards, coloured left borders, eyebrow/all-caps labels, oversized or hero headings, decorative illustrations, filler copy, or colours/fonts/radii/shadows written by the model. Styled screens take only colour roles and character from the preset guidance and ignore landing-page advice (hero, display headlines, banded sections).

**Lint and repair** (`planning/ux-lint.ts`) runs on the model's `<main>` content before the shell and stylesheet are added. **P0** (one repair turn, kept only if it has content and fewer P0s): `drew-shell`, `gradient`, `emoji-icon`, `filler-copy`, `raw-colour`, `fixed-width` (≥320px), `primary-overuse` (>2 in the main view), `table-columns` (a main-view table of more than 7 columns; the row-selection column does not count), `inline-form` (>3 fields outside the toolbar in a dashboard/list/board/analytics view). **P1** (advice): `style-dropped` (what the platform removed from the model's composition CSS), `left-accent-card`, `missing-h1`, `multiple-h1`, `two-primaries`, `nested-card`, `overlay-no-heading`, `missing-overlay`, `unlabelled-field`, `missing-page-header`, `too-many-blocks` (more than 5 blocks under the page header), `page-actions-overuse` (more than 3 actions in the page header). All findings are stored on the screen as `lint`.

**Element edit** (`UX_ELEMENT_SYSTEM_PROMPT` / `UX_ELEMENT_STYLED_SYSTEM_PROMPT`): the person selects one element on the canvas and says what to change. The request carries the screen's name, type and purpose, the design-system brief when styled, the whole page for context (icons collapsed, ≤40 000 characters) and the PART TO CHANGE; the model returns only a replacement fragment for that part, keeping the data-nid of elements it keeps, using the kit's classes and icons, never a whole page, a page header or overlays unless the part is one. A reply containing `<main>`, `<html>` or the content marker is rejected.

**Shared example data** (`sample_data` on the plan and the reference): the screens are drawn one at a time, so the plan writes once the data they all show — 3 to 8 main records (kind, name, key facts that agree with each other), the people with their roles, and notes (today's date, period, units). A draft planned before this gets it from one call (`UX_SAMPLE_DATA_SYSTEM_PROMPT`, once per draft — screens drawn at the same time wait for the same call) when its first screen is drawn. Every screen request and every element edit carries it as SHARED EXAMPLE DATA; the lint adds `off-sheet-data` (P1) when a screen names none of the records (full name, or its last two words). The canvas shows it as "Example data". The sheet also lists `statuses` (label → badge tone: success, warn, danger, info, accent or neutral). The platform sets that tone on every badge showing the label — whole, or as one "·"-separated part ("−7,15% · Terlambat") — when a screen is drawn, saved or edited, and when a draft is read (`planning/ux-status.ts`, no model call). A draft whose sheet has no list takes, per label, the tone at least 70% of its badges already use; a near tie is left alone, since it can be a deliberate severity split.

**Budgets** (`UX_BUDGETS` in `@sdd/contracts`): the numbers above — key elements, requirements and overlays per screen, stat cards, blocks, table columns, full-width and phone-card thresholds, facts per phone card, page actions, primary actions, the 320px phone width, the phone-screens limit, state frames — are defined once; the prompts interpolate them and the plan lint, screen lint, render check, composition CSS and phone-card trimming read them, and a test holds the prompt wording to them.

**Kit gallery** (`apps/api/tests/ux-kit-gallery.unit.test.ts`, fixture `tests/fixtures/ux-kit-gallery.html`): one page using every kit component, prepared like a drawing, framed with every library's skin and laid out at 390 and 1440. The render check must find nothing but the page's length, and layout probes must hold: no control stretched past 64px tall, no badge wider than 260px, no two page blocks touching, no board column cut on a desktop. Each probe is a bug first found by eye on a generated screen.

**Plan check** (`lintUxPlan`), before any screen is drawn. **P0** (one repair turn of the plan, kept only if it breaks fewer): `busy-screen-elements` (more than 5 key elements), `busy-screen-requirements` (more than 3 requirements on one screen — P1 when the person fixed the count), `wrong-count` (fewer screens than asked). **P1**: `uncovered-requirements` (approved requirements no screen serves; some have no screen of their own). The findings after the repair are stored on the reference as `plan_lint` and shown as "Plan: N notes" on the canvas.

**Render check** (`planning/ux-render.ts`): the framed screen is also laid out in a headless Chromium at 390×844 and 1440×900 (overlays hidden, page JavaScript off, every network request aborted) and measured. **P0**, joining the HTML lint's in the same repair turn: `phone-overflow` (page wider than the phone), `desktop-overflow`, `table-too-wide` (a table hides more than 24px behind a sideways scroll at 1440px). **P1**: `phone-too-long` (main view taller than 4 phone screens), `small-target` (controls under 32px on a phone), `squeezed-text` (text wrapped past three lines in a column under 72px), `tiny-text` (under 11px). Canvas saves and undo are checked the same way, and "Check again" re-checks a screen without an AI call. With no browser (`UX_RENDER_LINT=off`, or none installed) the render check is skipped and the HTML lint stands alone.

**Library skins** (`design-system/libraries.ts` `mockupCss`): choosing a component library changes the mockups — shadcn/ui follows the new-york-v4 registry (14px text, 36px controls, `rounded-md` controls, `rounded-xl` cards with `shadow-sm`, plain table header, segmented tabs, 16rem sidebar); daisyUI, Bootstrap, Material, Ant Design, Flowbite and Pico have their own sizes and shapes. The component map covers dialog, sheet, alert dialog, menu, breadcrumb, pagination, progress, skeleton and empty state as well.

## 6. Atomic task decomposition prompt

```text
Break the approved design into executable atomic tasks.

One task must describe one bounded, verifiable outcome.

Every feature task must link to one or more requirement or acceptance-criterion IDs.

For each task define:
- objective;
- dependencies;
- scope;
- constraints;
- acceptance criteria;
- verification;
- deliverables;
- stop conditions;
- risk factors;
- candidate parallel safety.

Order tasks by real implementation dependencies, not merely by frontend/backend labels.

Avoid tasks such as "build backend", "implement authentication system", or "finish UI".
Split those into bounded units.

Return TaskPlan schema.
```

Context the implementation adds to the task-generation request:
- **Approved design, every section:** overview, architecture summary and layout (`diagram_text`), components with interfaces, data model, API contracts, state machines, security, testing strategy, deployment, and unresolved decisions (blocking ones marked; tasks that depend on one list it in stop conditions). Verification commands, env vars, ports and paths are quoted from these sections, so none of them may be left out.
- **Project rules** (the constitution), when the project has any: no task may break them.
- **Approved UI reference:** each screen's file (`docs/ui-reference/<key>.html`), purpose, requirement keys and key elements. Neutral: "layout, elements and flow are binding; styling follows the design system or the stack". Styled: "layout, elements, flow and look are binding". The request also carries the exact constraint sentence screen-building tasks copy into their constraints (`screenConstraint` in `task/service.ts`): "…visual styling follows the stack" without a design system, "…visual styling follows docs/design-system/DESIGN.md" with one, "…and look follow <file>, drawn with the design system…" for a styled reference. Those tasks also include the screen's key elements in their acceptance criteria.
- **APP SHELL line** (`appShellLine` in `task/generation.ts`), with an approved UI reference: the navigation form (Android chrome for native-mobile; otherwise from `shell.layout`: sidebar, top nav or minimal), the destinations in order (settings last), the screens outside the shell (sign-in/sign-up/password screens, `isAuthScreen`) and the utilities (search, notifications, user menu; a reference without `shell` flags = all). The prompt rule: one front-end task builds this APPLICATION SHELL as the layout every screen renders inside; it depends on the design-system setup task and every screen task depends on it — no standalone pages, no second navigation. The design-system setup task owns the root layout; the shell task owns the layout around in-app routes and lists the shell utilities in its acceptance criteria. `hasShellTask` needs a shell word in a front-end task's title, a task that builds no screen itself, and — with screen tasks in the plan — one of them depending on it.
- **RENDER CHECK line** (`renderCheckLine`, web references only): every screen task carries a required Playwright test `e2e/render/<screen key>.spec.ts` at 1280×800 and 360×800 that signs in through a shared fixture, seeds or stubs its data, asserts the key elements (and the shell navigation) are visible and saves `docs/ui-reference/renders/<key>-1280.png`/`-360.png`; the design-system setup task installs Playwright with its Chromium browser and a self-stopping `webServer`.
- **One repair turn** (`planGaps` → `repairInstruction`) asks for everything the first plan lacks — the shell task (`SHELL_REPAIR_INSTRUCTION`) and the screen tasks without a render check — and is kept only if it is better and no worse; otherwise the first plan stands and lint keeps an unchecked screen task out of READY.
- **Approved design system:** a brief of the spec, plus "the first front-end task sets the design system up: install <library>, apply the theme file from `docs/design-system/` and load `tokens.css` — its checks include that light and dark mode render" and "UI tasks name the library components they use and must not hard-code colours or fonts".

## 7. Task-lint prompt

```text
Review this task contract for AI executability.

Flag:
- ambiguous outcome;
- missing verification;
- unbounded scope;
- multiple independent outcomes;
- unresolved dependency;
- missing traceability;
- contradictory constraints;
- excessive context;
- unsafe implicit architecture change.

Do not rewrite automatically unless requested.
Return lint findings and suggested split if needed.
```

## 8. Standalone agent work-order prompt

```text
# Work Order {{task_id}} — {{title}}

You are implementing one bounded task in an existing repository.

## Objective
{{objective}}

## Source requirements
{{requirements}}

## Acceptance criteria
{{acceptance_criteria}}

## Relevant design
{{design_context}}

## Scope
{{scope}}

## Constraints
{{constraints}}

## Dependencies
{{dependency_context}}

## Required verification
{{verification}}

## Deliverables
{{deliverables}}

## Stop conditions
{{stop_conditions}}

## Execution rules

1. Inspect the repository before editing.
2. Do not modify unrelated code.
3. Follow applicable repository `AGENTS.md` instructions and approved project constraints.
4. If the work order conflicts with an applicable `AGENTS.md`, approved requirement, or architecture constraint, stop and report the conflict instead of guessing.
5. Do not change approved architecture or add dependencies unless explicitly allowed by the approved task/design.
6. Run required verification.
7. Never claim a test passed if it was not run.
8. If a stop condition occurs, stop and explain the blocker.
9. At the end, report:
   - what changed;
   - files/components changed;
   - tests run;
   - test results;
   - remaining risks/limitations.

Task ID must remain {{task_id}} in your final summary.
```

## 9. Connected CLI work-order prompt

```text
You are assigned {{task_id}}.

This repository is connected to the SDD control plane.

Before implementation run:

  sddctl task context {{task_id}} --format agent

Read the returned task contract completely.

Then claim/start:

  sddctl task claim {{task_id}}
  sddctl task start {{task_id}}

During execution, report meaningful progress when useful.

Report required tests with sddctl.

If blocked:
  sddctl task block {{task_id}} --reason "<reason>"

When implementation and required verification are complete:
  sddctl task submit {{task_id}}

Do not self-approve the task.
Do not alter unrelated scope.
```

## 10. MCP-connected work-order prompt

```text
You are assigned {{task_id}}.

Use the configured SDD MCP server.

1. Call task_get for {{task_id}}.
2. Read the returned task contract.
3. Call task_claim.
4. Call task_start.
5. Execute only the authorized scope.
6. Report meaningful progress/test evidence through MCP tools.
7. If blocked, call task_block with a clear reason.
8. When implementation and required verification finish, call task_request_review.

Do not claim acceptance yourself.
```

## 11. Reviewer prompt

```text
Review run {{run_id}} against task {{task_id}}.

Primary truth:
- task objective;
- acceptance criteria;
- constraints;
- required verification.

Evidence:
- implementation summary;
- changed files/diff metadata;
- test results;
- run events.

Do not approve merely because the implementer says "done".

Classify findings:
- BLOCKING;
- HIGH;
- MEDIUM;
- LOW;
- INFO.

Return:
- acceptance criterion coverage;
- verification assessment;
- findings;
- recommended decision.
```

## 12. Bug assessment prompt

```text
Assess bug {{bug_id}}.

Use:
- current behavior;
- expected behavior;
- unchanged behavior;
- reproduction;
- linked task/run evidence.

Determine:
- confirmed/not confirmed;
- likely affected component;
- regression risks;
- additional evidence needed;
- smallest safe fix scope.

Do not implement during assessment.
```

## 13. Convergence prompt

```text
Evaluate whether feature {{feature_id}} converges with its approved specification.

Compare:
- functional requirements;
- acceptance criteria;
- completed tasks;
- the evidence of each task's approved run: its summary, the files it
  changed and its latest verification results;
- review decisions;
- known open bugs.

The run summary is the implementer's own claim. Passing verification results
and review decisions are stronger evidence; a criterion whose only support is
the summary is at most PARTIAL.

Classify each relevant requirement/criterion:
- COVERED;
- PARTIAL;
- MISSING;
- CONTRADICTED;
- NOT_APPLICABLE.

Do not assume all tasks DONE means the feature is complete.

For every blocking gap, produce a precise finding that can be converted into an atomic task.
```

With an approved UI reference the context lists the in-scope screens' key elements and the APP SHELL line; the prompt adds: "When an APP SHELL is given, every screen inside it renders within that shared navigation; a screen the evidence shows built as its own full-screen page or with its own navigation CONTRADICTS the UI reference."

Known limits (recorded in the locally archived delivery audit, §4.5): the release check still sees claims, files, test results and reviews, never a rendered screen — a missing render check does not yet make a screen PARTIAL (R5). A requirement linked to several features is judged once per feature, which can produce near-duplicate fix tasks.
