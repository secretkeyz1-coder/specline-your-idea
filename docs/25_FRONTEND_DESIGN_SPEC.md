# Frontend Design Reference — Open-Source Guided SDD UI

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

## Purpose

This document defines the frontend direction for the Agentic SDD Control Plane.

The screenshots supplied during planning are **UX inspiration only**. They may inform ideas such as guided onboarding, progressive disclosure, and a planning visualization, but implementation must **not reproduce their brand, exact layout, typography, spacing, colors, card composition, navigation treatment, or screen structure pixel-for-pixel**.

Primary implementation reference: `frontend_reference.html`.

**Implemented state:** the web app (`apps/web`) is built with **daisyUI 5** on Tailwind CSS v4. The record of what was built — tokens, components, surfaces, motion, accessibility floor — is `DESIGN.md` at the repository root; the token source of truth is `apps/web/src/app.css`. Where this document describes intent that differs from the built app, `DESIGN.md` and `app.css` win.

---

## Product Positioning

This is an **open-source planning and agent-execution tool**, not a commercial SaaS pricing funnel.

The core application UI must not contain monetization-tier badges, upsell controls, subscription prompts, or paywall indicators.

Appropriate top-right actions are instead:

- Documentation
- GitHub / repository
- AI provider settings
- account/workspace menu when authentication is enabled

---

## Design Direction

The product should feel like:

> **A focused technical workspace that begins simple and reveals power progressively.**

It should not feel like:

- Jira on the first screen
- an enterprise ERP dashboard
- a clone of another planning SaaS
- an AI chat interface with dozens of controls visible immediately

### Visual identity

Reference direction:

- deep navy / ink background
- slate-blue surfaces
- indigo as primary interactive accent
- mint/teal for positive/readiness signals
- blue, amber, violet only for semantic categories
- thin borders
- restrained shadows
- compact rounded corners
- strong typography hierarchy
- generous empty space

Do not use another product's exact orange/navy palette or exact header treatment simply because it appeared in reference screenshots.

### Implemented visual system (daisyUI 5)

The list above was the original direction; the built app uses daisyUI's themes instead of a custom navy palette. Summary (details in `DESIGN.md`):

- **Themes / daisyUI 5:** custom `forest` (dark, default) / `forest-light`, built-in themes disabled (`themes: false`). Sidebar choice stores `sdd-theme`; `app.html` maps legacy names before first paint.
- **Tokens:** the app's names (`ground`, `surface*`, `line*`, `text-primary/muted/faint`) are mapped onto daisyUI variables in `@theme inline`, so every utility follows the theme. `primary` (indigo-violet) is the interaction and CTA colour.
- **Status colour:** status text (`mint`, `warn`, `danger`, `sky`, `violet`) mixes the daisyUI status colour with `base-content`, because raw daisyUI `success`/`warning`/`info` fail AA as text. Every text pairing passes WCAG AA in both themes; an axe audit passes on all pages in light and dark, desktop and 390 px.
- **Components:** daisyUI classes, native `<dialog>` wrapper, popover API and native selects; no current bits-ui behavior layer.
- **Type and geometry:** Geist Variable (display and body), Fira Code Variable (keys, paths, commands); daisyUI radius tokens only (`rounded-field`, `rounded-box`, `rounded-selector`).
- **Shared app components:** `AppHeader`, `CommandPalette`, `ProjectNav`, `JourneyRail`, `NextStepBar`, `AiProgress`, `Notice`, `StatusBadge`, `PhaseSegment`.

This is the app's own look. The **design system artifact** a project defines for the product it builds (presets, component library, theme exports) is separate — see `docs/14_UI_UX_SPEC.md` §10.

---

## UX Principles

### 1. Guided, not dashboard-first

Before a project has a generated plan, avoid a permanent sidebar and dashboard statistics.

Primary phases:

```text
Discover → Define → Build
```

The phase navigator should be compact and visually distinct from the supplied references. The HTML reference uses a segmented navigation control rather than connected dots/lines.

Inside a project, the implemented app shows the 9-milestone journey (Discovery → Requirements → Stack → Technical design → Design system (optional) → UI reference (optional) → Tasks → Build → Release) as a `JourneyRail` on the Plan page and a one-step `NextStepBar` on every other project page.

### 2. Progressive disclosure

The user begins with only the information needed for the current decision.

```text
Idea
 ↓
Clarification
 ↓
Technical preferences
 ↓
High-level plan
 ↓
Specification
 ↓
Atomic tasks
 ↓
Agent work order
```

Architecture, contracts, database details, test requirements, task DAGs, agent telemetry, and review history become visible only after they are relevant.

### 3. One meaningful decision at a time

Discovery should normally show **one primary question at a time**.

The page may also display a small summary of facts already understood by AI so the user can detect incorrect assumptions early.

This differs intentionally from questionnaire pages that display all questions at once.

### 4. User remains decision authority

AI can:

- recommend a stack
- suggest requirements
- identify ambiguity
- propose atomic tasks

But explicit user choices override AI recommendations.

### 5. Open-source trust

Provider configuration should communicate:

- user's own API credentials
- custom provider capability
- self-hostability
- no hidden mandatory provider

Secrets never appear in generated specs/tasks.

---

# Primary Screens

## 1. Start / High-Level Idea

### Layout

Use a two-column desktop layout:

```text
Explanation / workflow       High-level idea composer
```

Left:

- compact kicker
- headline
- short explanation
- 3-step explanation of what happens next

Right:

- idea composer
- optional reference attachment
- language
- primary `Mulai discovery` action

This must not use an exact centered hero composition copied from another product.

### Goal

A user should be able to start with one paragraph even when their idea is incomplete.

---

## 2. Discovery

Default interaction pattern:

```text
Discovery round
Question 2 of 5

[ one important question ]
[ response ]
[ optional suggested answers ]

Already understood by AI:
[ fact ] [ fact ] [ constraint ]
```

Question types:

- free text
- single choice
- multi-choice
- number/date
- constraint selection
- custom answer

Questions are generated adaptively. `5` is not a mandatory count.

The discovery engine stops when readiness is sufficient or the user explicitly decides to continue with known assumptions.

---

## 3. Technical Preferences

Avoid large duplicated choice cards.

Use a compact mode selector:

```text
[ Use AI recommendation ] [ Choose manually ]
```

Below it show technology layers as compact editable rows. In manual mode, any unresolved row may individually request an AI suggestion without creating a third top-level mode.

Reference values for this project:

| Layer | Default |
|---|---|
| Frontend | SvelteKit + TypeScript |
| Backend | Bun + Elysia |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| Deployment | Docker Compose / VPS |

AI recommendation should include a short reason, not just a technology name.

---

## 4. High-Level Planning View

The planning visualization is for **understanding scope**, not for storing authoritative task state.

Reference composition:

```text
Project Intent
     │
     ├── Discover
     │    ├── idea
     │    ├── clarification
     │    └── readiness
     │
     ├── Define
     │    ├── requirements
     │    ├── architecture
     │    └── task graph
     │
     └── Build
          ├── work order
          ├── CLI / MCP
          └── review
```

The HTML reference expresses this as a project-intent card followed by independent feature columns, rather than reproducing a specific mind-map layout from reference screenshots.

Possible future views:

- tree
- DAG
- roadmap
- feature grouping

Database remains the source of truth.

---

## 5. Documentation

After high-level planning, the user can inspect generated artifacts.

Suggested sections:

- Overview
- Requirements
- Technical design
- Data model
- API/contracts
- Security
- UAT
- ADR / decisions

Implemented: five link-based tabs (the URL is the state) — Requirements · Tech stack · Technical design · Design system · UI reference. Data model, contracts, tests and deployment are sections of the technical design.

Do not display all documents at once.

---

## 6. Atomic Tasks

Default view should remain simple and readable.

Each task row initially shows:

- task ID
- title
- feature/module
- workflow status
- hardness
- open action

Advanced views can include:

- dependency DAG
- Kanban
- agent runs
- test status
- blocked reasons

---

## 7. Agent Work Order

This is intentionally the most detailed UI.

Must expose:

- objective
- parent requirement/story
- acceptance criteria
- dependencies
- allowed scope
- forbidden scope
- implementation constraints
- verification commands
- deliverables
- stop conditions
- standalone prompt
- connected CLI/MCP instructions
- latest agent run
- review controls

The implementing agent cannot self-approve by default.

---

# AI Provider Settings

Provider configuration remains outside the planning wizard.

Support:

- OpenAI
- Anthropic
- Gemini
- OpenAI-compatible endpoints
- generic custom HTTP adapters
- Local CLI (Claude Code / Codex) running on the server or on the user's own machine through `sdd-agent`

A provider contains connection credentials/configuration.

An AI Profile defines role-specific model behavior.

Example roles:

```text
Discovery
Specification
Architecture
Task decomposition
Review
Convergence
```

The same project may use different providers/models for different roles.

---

# SvelteKit Information Architecture

Implemented routes:

```text
apps/web/src/routes/
├── +layout.svelte
├── +page.svelte                      # start: idea composer + recent projects
├── login/ · cli/authorize/ · machines/
├── new/discovery/[projectId]/+page.svelte
├── projects/[projectId]/
│   ├── +page.svelte                  # plan + journey panel
│   ├── stack/+page.svelte
│   ├── docs/+page.svelte             # ?tab=requirements|stack|design|system|ux
│   ├── docs/requirements/edit/+page.svelte
│   ├── docs/design/edit/+page.svelte
│   ├── design-system/+page.svelte    # optional
│   ├── ux/+page.svelte               # optional UI reference
│   ├── tasks/+page.svelte
│   ├── tasks/[taskId]/+page.svelte
│   ├── board/ · bugs/ · convergence/
└── settings/
    └── ai/+page.svelte
```

Suggested reusable components:

```text
AppHeader
PhaseSegment
IdeaComposer
DiscoveryFocusQuestion
UnderstoodFacts
StackModeSelector
TechnologyRow
PlanningWorkspace
ProjectIntentCard
FeatureColumn
DocumentTabs
AtomicTaskRow
TaskStatus
AgentWorkOrder
ProviderCard
AIRoleRouter
```

---

# Responsive Behavior

Desktop:

- idea page can use split composition
- planning view uses a wide visual workspace
- documentation can use local secondary navigation

Mobile:

- stack vertically
- hide the global phase segment if space is limited
- preserve one-question discovery
- planning canvas can switch from visual graph to structured outline/cards
- task work order uses one column

Do not shrink a desktop graph until it becomes unreadable.

---

# Originality Guardrails

When an AI coding/design agent implements the UI:

1. Do not copy names, logos, icons, copywriting, commercial tier badges, avatar treatment, or branded elements from external references.
2. Do not reproduce exact screen proportions or card locations.
3. Do not reproduce another product's progress indicator one-to-one.
4. Do not treat reference screenshots as a Figma spec.
5. Extract UX principles, then implement them using this project's own design tokens and components.
6. Prefer system/product terminology defined in our specification.
7. If uncertain whether a detail is product-specific to a reference, create an original alternative.

---

# Avoid

- permanent sidebar during initial discovery
- monetization-tier / upsell elements
- dashboard metrics before planning exists
- giant AI chat surfaces everywhere
- displaying every spec artifact simultaneously
- excessive badge/color usage
- copying external brand language
- pixel-matching supplied references
- dense Jira/ERP styling for normal users

The desired feeling is:

> **simple at the surface, structured underneath, powerful when opened deeper.**
