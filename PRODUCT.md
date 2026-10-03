# PRODUCT.md — Agentic SDD Control Plane

> Original product baseline: `docs/` specification pack (00–27); HTML prototype is historical intent.
> Current behavior comes from code/configuration. [Navigation](docs/README.md).
> This file was inferred from the explicit brief and those docs (user directed
> implementation without an interview); assumptions are labeled where the docs
> leave a decision open (`docs/27_OPEN_DECISIONS.md`).

## What this is

A web-based **planning and execution control plane** that turns a vague software
idea into clarified requirements, an explicit tech-stack decision, a technical
design, atomic tasks, and verifiable work orders for local AI coding agents.
The web app is the source of truth for planning artifacts, task state, runs,
reviews and bugs; a CLI (`sddctl`) and a remote MCP endpoint connect local
agents to it.

## Who it serves

- **Solo builders** turning an idea into an executable plan.
- **Technical PMs** defining outcomes while agents decompose the work.
- **Engineering leads** controlling architecture and review while agents execute.
- **AI coding agents** consuming structured work orders (CLI/MCP).

## The one job

Close the gap between "I have an idea" and "an agent has a bounded, testable
work order and can prove what it changed" — with every task traceable upward to
a requirement and downward to execution evidence.

## Modes (visitor success per surface)

- **Start / Discovery / Stack surfaces → Persuade-of-clarity (guided Operate):**
  one meaningful decision at a time; the user must always know what happens next.
- **Docs / Plan / Tasks / Work order / Review / Release check (convergence) → Operate:**
  scanability, progressive disclosure, evidence-first. Power revealed gradually,
  never dashboard-first.
- Brand lives in precise details; the product must feel "simple at the surface,
  structured underneath, powerful when opened deeper" (docs/25).

## Non-negotiable experience rules

1. Guided planning before execution; AppSidebar carries navigation and the
   nine-chapter journey, without metrics-first dashboards or Jira/ERP density.
2. One primary discovery question at a time; "Already understood" facts stay
   visible and correctable.
3. Requirements approve **before** technology; stack has exactly two modes
   (AI recommendation / manual), manual rows can individually ask AI.
4. A person approves (any workspace member, the implementer included — no reviewer
   roles) or the review policy does; an agent never approves. Review pairs contract + evidence.
5. Bugs are entities, not statuses. Features complete only through the
   convergence gate.
6. No monetization/upsell controls anywhere (open-source core, C23).
7. Never show stored provider secrets; secrets never enter prompts/exports.
8. Every AI flow has running / failed / retry / manual-edit fallback states;
   provider failure never traps user data.

## Visual world (recorded from `apps/web/src/app.css`)

- daisyUI 5 on Tailwind CSS v4: custom `forest` (dark, default) and
  `forest-light` (warm paper), built-in themes disabled. Sidebar choice is stored
  in `sdd-theme`; `app.html` maps legacy names before first paint.
- Canvas `base-200`, cards `base-100`, wells `base-300`; `line` hairlines and
  `line-control` control edges. Green primary fills use black text;
  `primary-ink` supplies readable green text. Status tokens are separate.
- Pill controls (`rounded-field`, 2rem), cards (`rounded-box`, 1rem), flat depth.
  AppSidebar and the nine-chapter journey replace the older phase navigator.
- Typography: Geist Variable for UI/display, Fira Code Variable for monospace.
- Lucide icons. Original composition — clean, minimal, utility-first.
- Mobile: stack vertically, keep one-question discovery, wide tables scroll
  inside their own container, planning canvas becomes an outline/card fallback.

Token source of truth is `apps/web/src/app.css`; `DESIGN.md` records the built
world and must be updated with it.

## Platform

SvelteKit + Svelte 5 + TypeScript + Tailwind v4 + lucide-svelte; talks to the
Bun/Elysia API at `API_PUBLIC_URL` (server-side only, via `$env/dynamic/private`)
with cookie session auth. Primary surfaces:

`/` Start / Today → `/projects/[projectId]/discovery` → `/projects/[projectId]/stack` →
`/projects/[projectId]` (plan map) → `/docs` → `/tasks` (+ `/tasks/[taskId]`
work order) → `/board` (execution kanban) → `/bugs` → `/convergence` →
`/settings/ai` (provider connections, AI profiles, role routing) →
`/login`, `/cli/authorize` (device approval), `/machines` (connected agents).
