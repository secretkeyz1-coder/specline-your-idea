# API Contract

This document defines logical endpoints. Exact paths can be versioned under `/api/v1`.

## 1. General conventions

### Authentication

```http
Authorization: Bearer <token>
```

Browser may use secure session cookie.

### Errors

```json
{
  "error": {
    "code": "TASK_NOT_READY",
    "message": "Task cannot be claimed.",
    "details": {
      "task_id": "TASK-084"
    },
    "trace_id": "..."
  }
}
```

A body that cannot be parsed (malformed JSON, wrong content type) is `400 INVALID_BODY`; a body or query that fails schema validation is `422 VALIDATION_ERROR`.

### Cross-origin requests

Credentialed CORS is granted only to `WEB_PUBLIC_URL`'s origin. Outside production the same port on `localhost`, `127.0.0.1` and `[::1]` is also allowed; any other origin gets no CORS headers.

### Idempotency

Mutation endpoints that can be retried by CLI/daemon accept:

```http
Idempotency-Key: <uuid>
```

## 2. Projects

### Create project

`POST /api/v1/projects`

```json
{
  "name": "My Application",
  "high_level_idea": "Build ...",
  "constraints": [],
  "workspace_id": "optional uuid"
}
```

Requires write access (OWNER/ADMIN/MEMBER) to the target workspace and, for API tokens, the `artifact:write` scope; tokens restricted to a single project are refused (`403`). Without `workspace_id` the project goes to the caller's default workspace: a token's own workspace, otherwise the user's oldest membership with write access (then the oldest of any role) — the same workspace `GET /projects` lists by default. A caller-chosen `key` already used in the workspace is `409 PROJECT_KEY_TAKEN`.

### List projects

`GET /api/v1/projects?workspace_id=...`

Defaults to the same workspace as project creation. A token restricted to one project sees only that project.

Each project carries real progress counts (cancelled tasks/features excluded), so the UI can say "Building · x/y tasks", "Release check · x/y verified" or "Complete" instead of the lifecycle label alone:

```json
{
  "projects": [
    {
      "id": "...",
      "name": "My Application",
      "lifecycle_status": "EXECUTION_READY",
      "progress": {
        "tasks_total": 24,
        "tasks_done": 10,
        "tasks_started": 13,
        "features_total": 4,
        "features_complete": 1
      }
    }
  ]
}
```

`tasks_started` counts every task that is past `DRAFT`/`READY` (claimed, running, in review, blocked or done).

### Get project

`GET /api/v1/projects/{projectId}`

### Update project

`PATCH /api/v1/projects/{projectId}` with any of `name`, `high_level_idea`, `project_rules` — admin access (`workspace:admin` for tokens). Audited as `project.updated` (changed fields; the new rules when they changed).

### Project activity

`GET /api/v1/projects/{projectId}/activity?limit=100` — newest audit events first; `limit` is 1–500 (default 100), anything else is `422 VALIDATION_ERROR`.

### Workspaces

`POST /api/v1/workspaces` `{ "name": "..." }` — the caller becomes OWNER, so it requires a signed-in browser session; API tokens get `403`.

`GET /api/v1/workspaces/{workspaceId}/members` — any member, but not a token restricted to a single project (the list is workspace-wide).

`POST /api/v1/workspaces/{workspaceId}/members` `{ "email": "...", "role": "ADMIN|MEMBER|VIEWER" }` — admin access; audited as `workspace.member_added`.

## 3. Discovery

### Start discovery

`POST /api/v1/projects/{projectId}/discovery-sessions`

Idempotent: returns the project's live (ACTIVE or COMPLETED) session, creating one only when none exists (concurrent starts serialize on the project). It also drafts the first question batch, so it counts against the `AI` rate limit (`429 RATE_LIMITED`). A domain-level refusal while drafting (e.g. no AI provider bound) is logged and the session is still returned; other failures surface as errors.

### Get current discovery

`GET /api/v1/projects/{projectId}/discovery`

### Answer question

`POST /api/v1/discovery/questions/{questionId}/answer`

```json
{
  "answer": "Full offline data capture is required."
}
```

### Generate next questions

`POST /api/v1/discovery/sessions/{sessionId}/next`

### Proceed with assumptions

`POST /api/v1/discovery/sessions/{sessionId}/accept-assumptions`

Answering, deferring (`POST /api/v1/discovery/questions/{questionId}/defer`) and accepting assumptions only work on an ACTIVE session; a completed or abandoned one is `409 DISCOVERY_CLOSED`.

### Complete discovery

`POST /api/v1/discovery/sessions/{sessionId}/complete` with optional `{ "accept_assumptions": true }`.

An incomplete discovery is `409 DISCOVERY_INCOMPLETE` unless `accept_assumptions` is true. Then every required topic still uncovered (and every blocking question left unanswered) is recorded as an explicit ACCEPTED assumption before the proposed ones are accepted, so requirements generation can proceed and the record says what was assumed. Completion is audited (`discovery.completed`). A COMPLETED session always satisfies the requirements gate.

## 4. Artifacts

### Generate requirements

`POST /api/v1/projects/{projectId}/artifacts/requirements/generate`

### Get artifact

`GET /api/v1/artifacts/{artifactId}`

`GET /api/v1/projects/{projectId}/artifacts/{type}` — the project's artifact of that type with all revisions. Read-only: before the first draft exists it returns `{ "artifact": null, "revisions": [] }` (it no longer creates the artifact row).

### Create revision

`POST /api/v1/artifacts/{artifactId}/revisions`

### AI refine

`POST /api/v1/artifacts/{artifactId}/refine`

### Approve revision

`POST /api/v1/artifact-revisions/{revisionId}/approve`

Only the artifact's current draft is approvable: an older draft is `409 REVISION_OUTDATED` (details carry `current_draft_revision_id`); an approved, stale or superseded revision is `409 REVISION_ALREADY_APPROVED` / `REVISION_NOT_APPROVABLE`. Approving supersedes the previous baseline and every other open draft of the artifact, and — in the same transaction — moves the project's active revision pointer and lifecycle (requirements/stack/design) and writes the audit event.

## 5. Stack

### Recommend stack

`POST /api/v1/projects/{projectId}/stack/recommend`

```json
{
  "mode": "RECOMMENDED",
  "preferences": {}
}
```

### Validate custom stack

`POST /api/v1/projects/{projectId}/stack/validate`

Returns `{ conflicts, decision }` (deterministic checks plus the model's findings). Validation only: it stores no stack draft and does not move the project lifecycle.

### Approve stack

`POST /api/v1/projects/{projectId}/stack/approve`

## 6. Design

`POST /api/v1/projects/{projectId}/design/generate`

`POST /api/v1/design/{designId}/refine`

`POST /api/v1/design-revisions/{revisionId}/approve`

### Design system (optional, after the stack is locked)

Written by a person from presets — no AI call. Approval uses the generic `POST /api/v1/artifact-revisions/{revisionId}/approve`. A stack change marks it stale.

`GET /api/v1/design-systems/catalog` → `{ "presets": [...], "libraries": [...] }` — 14 generic presets (each light + dark, all WCAG AA) and the component-library catalog.

`POST /api/v1/design-systems/preview` — render only, nothing stored:

```json
{ "spec": { "...": "DesignSystemSpec" }, "mode": "light" }
```

Response: `{ "html": "<preview document>", "contrast": [{ "mode": "light", "pair": "...", "foreground": "fg", "background": "bg", "ratio": 12.4, "minimum": 4.5, "ok": true }] }`.

`GET /api/v1/projects/{projectId}/design-system` → `{ stack_approved, suggestions: [{library_id, reason}], approved, draft, stale }`; `approved`/`draft` are `{ revision_id, version, approved_at, spec, library_name }` or `null`. Suggestions rank the libraries for the locked stack.

`POST /api/v1/projects/{projectId}/design-system` with `{ "spec": DesignSystemSpec }` saves a draft revision. Errors: `409 STACK_NOT_APPROVED`; `VALIDATION_ERROR` for an invalid spec, an unknown `component_library`, or any failing contrast pair (details list the failing pairs). Contrast passes on the exact WCAG ratio (4.497:1 fails 4.5:1); the reported `ratio` is truncated to two decimals for display. A `name` may not contain control characters, line breaks, `*/`, `<`, `>`, `{`, `}` or `;`; each `fonts` value must be a CSS font-family list (quoted names or plain identifiers separated by commas). Exports escape both again wherever they are written (CSS comments and strings, TS string literals, HTML).

`GET /api/v1/projects/{projectId}/design-system/export` → `{ "version": 2, "dir": "docs/design-system", "files": [{ "path", "content", "description" }] }` (empty `files` and `version: null` when nothing is approved). `sddctl ui pull` writes these files.

### UI reference (optional, after the design)

`GET /api/v1/projects/{projectId}/ux`

`POST /api/v1/projects/{projectId}/ux/plan`

```json
{
  "mode": "plan",
  "screen_count": 6,
  "guidance": "Focus on the mobile check-in flow",
  "fidelity": "styled"
}
```

- `mode`: `plan` (new draft) or `revise` (start a draft from the approved reference).
- `screen_count`: 1–12, or omitted/`null` to let the AI recommend the number with a reason (`recommended_count`, `count_rationale`). A requested count is never exceeded.
- `guidance`: up to 1,000 characters.
- `fidelity`: `neutral` (default, greyscale mid-fi) or `styled` (drawn with the approved design system; the version is stored as `design_system_version`). `409 DESIGN_SYSTEM_NOT_APPROVED` if none is approved.
- Preconditions: approved requirements, stack and design (`409 REQUIREMENTS_NOT_APPROVED` / `STACK_NOT_APPROVED` / `DESIGN_NOT_APPROVED`).

`POST /api/v1/projects/{projectId}/ux/screens` — add a screen to the draft:

```json
{ "name": "Settings", "purpose": "...", "key_elements": ["..."], "requirement_keys": ["FR-004"] }
```

`409 UX_TOO_MANY_SCREENS` above 12, `409 UX_NOT_APPLICABLE` for products without a UI.

`DELETE /api/v1/projects/{projectId}/ux/screens/{screenKey}` — remove a draft screen; `409 UX_LAST_SCREEN` for the last one.

`POST /api/v1/projects/{projectId}/ux/screens/{screenKey}/generate` with optional `{ "instruction": "..." }` draws (or redraws) one screen — one AI call per screen.

`POST /api/v1/projects/{projectId}/ux/screens/{screenKey}/generate-stream` takes the same body and draws the same way, answering with server-sent events so the canvas can show the screen as it is written: `frame` (`{ html }`, the screen's shell with an empty `<main>`, sent once), `content` (`{ html }`, the sanitized content of `<main>` so far, at most every 350 ms, and once more when the first drawing is complete), `phase` (`{ phase: "checking" }`, the drawing is being checked and may still be repaired), then `done` (`{ ok: true }`, the draft has the screen) or `error` (`{ code, message }`). `content` events arrive only from providers that stream (OpenAI-compatible, Anthropic, Gemini); others send `frame`, `phase` and the outcome. Access and rate-limit refusals answer before the stream opens, as the usual JSON error.

Canvas edits of a drawn draft screen (no AI call); each saves the screen's previous content to its undo history (at most 5). They share a per-user rate-limit bucket of their own (`429` past it), since each save, undo, restore and check renders the screen in a browser. Save, undo and restore take an optional `base`, the screen version the canvas edited: `"<history[0].at or ->#<history length>"` (every content change pushes or pops a history entry). A screen changed since answers `409 UX_SCREEN_CHANGED` and nothing is written; without `base` (older clients) the write is not checked. Any write to a draft that "Plan again" or "Revise" replaced meanwhile answers `409 UX_DRAFT_REPLACED`.
- `POST …/ux/screens/{screenKey}/content` `{ "content": "<page content>", "note"?: "Edited text: …", "base"?: "…" }` — content edited on the canvas (text, `data-link` to another screen). It is sanitized, tables wrapped, element ids (`data-nid`) kept or added, linted and re-framed like model output.
- `POST …/ux/screens/{screenKey}/undo` `{ "base"?: "…" }` — restore the previous content; `409 UX_NOTHING_TO_UNDO` when there is none.
- `POST …/ux/screens/{screenKey}/restore` `{ "at": "<history[].at>", "index"?: 0, "base"?: "…" }` — put that history entry back, named by its time (`index`, 0 = newest, is still accepted alone; given with `at` the two must agree, else `409 UX_SCREEN_CHANGED`). Unlike undo nothing is lost: the content being replaced becomes the newest entry (note `Restore to the version before "…"`, naming the original change even when restoring a restore) and the restored entry leaves the list; so a restore can itself be restored (redo). `404` for a version not in the history.
- `POST …/ux/screens/{screenKey}/comments` `{ "nid": "n12", "anchor"?: "Heading 1: Projects", "text": "…" }` — pin a comment to an element; `404` when no element has that id.
- `POST …/ux/screens/{screenKey}/comments/{commentId}` `{ "action": "resolve" | "reopen" | "delete" }`.
- `POST …/ux/screens/{screenKey}/element` `{ "nid": "n12", "instruction": "Turn these filters into tabs" }` — change one element with AI (one call, rate-limited like a draw): the model gets the page for context and returns a replacement for that element only, which is put in place, sanitized, numbered, checked (HTML lint and render check) and framed; the previous content goes onto the undo history. Returns `{ revision, screen, nid }` (`nid` = the element now in its place). `404` for an unknown element, `422` for a part over 30 000 characters, `409 UX_SCREEN_CHANGED` if the screen changed meanwhile, `502 AI_OUTPUT_INVALID` if the model returned a whole page or nothing.
- `POST …/ux/screens/{screenKey}/check` — check the drawn screen again (HTML lint and the render check at phone and desktop width) and store the findings as its `lint`; no AI call, no history entry. `409 UX_SCREEN_NOT_DRAWN` for a screen not drawn yet.

Screens carry `history[]` and `comments[] {id, nid, anchor, text, author_id, created_at, resolved_at}`; `GET …/ux` numbers the elements of screens stored before ids existed, the same way a save will, and sanitizes framed screens again on the way out. After a redraw, save, element change, undo or restore, each comment keeps its `nid` while that element still shows the anchor's text, moves to the (innermost) element that does, or gets `nid: null` (the element no longer exists).

Page content is sanitized by parsing it and writing it out again from an allowlist (planning/ux-sanitize.ts): common HTML, tables, form controls as inert drawings (no `action`/`method`/`formaction`), SVG drawing elements (no gradients, `<use>`, images, links, animation or `foreignObject`), `class`/`id`/`role`/`data-*`/`aria-*`, inline styles without `url()`/`expression()`/escapes, links only to `#…` or `./<screen>.html` (others become `#`), images only as `data:` PNG/GIF/JPEG/WebP. `<style>` (composition CSS) stays outside SVG, without `<` or `@import`, and is cleaned and scoped by the shell (an unclosed one runs to the end of the content). Every stored screen's head starts with the mockup CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`), and `sddctl ui pull` puts it first in every file it writes.

## 7. Task generation

### Generate tasks

`POST /api/v1/projects/{projectId}/tasks/generate`

or feature-scoped:

`POST /api/v1/features/{featureId}/tasks/generate`

### Task lint

`POST /api/v1/tasks/{taskId}/lint`

### Add a render check (DRAFT screen task)

`POST /api/v1/tasks/{taskId}/render-check`

For a DRAFT task that builds a UI-reference screen and has no render check (lint `no_render_check` keeps it out of READY). Appends the standard Playwright command for its screens (`<runner> playwright test e2e/render/<screen>.spec.ts`, the runner taken from its other checks: `bunx`, `pnpm exec`, `yarn` or `npx`), adds `automated_tests` to its deliverables, and re-checks readiness. `409 NOT_A_SCREEN_TASK` for a task that builds no screen; `409 TASK_CHECKS_FULL` when the task already has six checks; `409 TASK_NOT_MUTABLE` once it left DRAFT.

### Validate graph

`POST /api/v1/projects/{projectId}/task-graph/validate`

## 8. Task reads

### List tasks

`GET /api/v1/projects/{projectId}/tasks?status=READY`

### Get task

`GET /api/v1/tasks/{taskId}`

Besides the task, its dependencies, dependents and traceability, the response carries `screen_review` for a task that builds a screen of the approved UI reference (null otherwise): `{ screens: [{ file, name, key_elements, inside_shell }], render_check: { required, command }, screenshots_dir }`. The web review panel renders it as the reviewer's checklist.

### Get agent context pack

`GET /api/v1/tasks/{taskId}/agent-context`

Response:

```json
{
  "task": {},
  "requirements": [],
  "acceptance_criteria": [],
  "design_sections": [],
  "contracts": [],
  "project_rules": [],
  "dependency_outputs": []
}
```

### Generate prompt

`POST /api/v1/tasks/{taskId}/prompt`

```json
{
  "mode": "CONNECTED_CLI"
}
```

Modes:
- `STANDALONE`
- `CONNECTED_CLI`
- `CONNECTED_MCP`

## 9. Task claim

`POST /api/v1/tasks/{taskId}/claim`

Request:

```json
{
  "executor": {
    "type": "LOCAL_AGENT",
    "id": "machine-agent-id"
  },
  "lease_seconds": 900,
  "machine_id": "optional — sent by sdd-agent only"
}
```

`machine_id` (optional) must be one of the caller's own non-revoked machines (and the token's machine for a pairing token). It marks the run as driven by that machine's `sdd-agent`: cancel, requeue and unblock-to-READY push `cancel_task` to it, and a resume is handed back to it (§22).

Response:

```json
{
  "task_id": "TASK-084",
  "run_id": "run_uuid",
  "lease_id": "lease_uuid",
  "lease_expires_at": "..."
}
```

Conflict:

`409 TASK_ALREADY_CLAIMED`

## 10. Start run

`POST /api/v1/runs/{runId}/start`

The task transition (CLAIMED → IN_PROGRESS) and the run transition (CREATED → RUNNING) commit in one transaction. `POST /runs/{runId}/request-review` is likewise atomic (evidence check, task → NEEDS_REVIEW, run → SUBMITTED, lease released).

## 11. Heartbeat

`POST /api/v1/runs/{runId}/heartbeat` — `{ "lease_seconds": 900 }` (60–3600). Renews the lease of the caller's run; `409 LEASE_EXPIRED` / `LEASE_NOT_ACTIVE` means the run is no longer the caller's (cancelled, requeued, expired) and the executor must stop.

Owner-authenticated run writes (`/events`, `/tests`) also extend the lease to at least 900 s from now (never shorten it), so an agent that reports progress keeps its claim without calling heartbeat. `sddctl run heartbeat` and the MCP tool `task_heartbeat` call this endpoint explicitly.

## 12. Progress event

`POST /api/v1/runs/{runId}/events`

```json
{
  "type": "progress_reported",
  "client_sequence": 12,
  "message": "Implemented repository transaction",
  "progress": {
    "completed_steps": 2,
    "total_steps": 4
  }
}
```

## 13. Test report

`POST /api/v1/runs/{runId}/tests`

```json
{
  "command": "bun test apps/api/src/modules/task",
  "status": "PASSED",
  "exit_code": 0,
  "duration_ms": 3150,
  "summary": "42 tests passed"
}
```

## 14. Block task

`POST /api/v1/runs/{runId}/block`

```json
{
  "reason_code": "AMBIGUOUS_REQUIREMENT",
  "message": "Acceptance criterion does not define lease grace behavior."
}
```

## 15. Request review

`POST /api/v1/runs/{runId}/request-review`

```json
{
  "summary": "Implemented atomic claim...",
  "commit_sha": "abc123",
  "files_changed": [
    "apps/api/src/modules/task/service.ts"
  ]
}
```

Server verifies required validation evidence.

Under an `AUTO_RUN` repository link the review policy approves the run when every required check passed — except a web screen task with no render check: the response then carries `auto_approve_withheld` (the reason) and the task waits in `NEEDS_REVIEW` for a person.

## 16. Review

### Approve

`POST /api/v1/reviews`

```json
{
  "task_id": "...",
  "run_id": "...",
  "decision": "APPROVED",
  "summary": "Acceptance criteria satisfied."
}
```

### Request changes

Same endpoint:

```json
{
  "decision": "CHANGES_REQUESTED",
  "findings": [
    {
      "severity": "HIGH",
      "message": "Concurrent second claim is not covered by test."
    }
  ]
}
```

## 17. Bugs

`POST /api/v1/projects/{projectId}/bugs`

`GET /api/v1/bugs/{bugId}`

`POST /api/v1/bugs/{bugId}/confirm`

`POST /api/v1/bugs/{bugId}/transition` — `{ "status": "...", "note": "..." }`

`POST /api/v1/bugs/{bugId}/generate-fix-tasks`

API tokens (CLI, MCP, pairing/machine) may report bugs and move them through the reporting and fixing states (ASSESSING, CONFIRMED, PLANNED, IN_FIX, VERIFYING). The closing decisions — VERIFIED, CLOSED, WONT_FIX, NOT_A_BUG, DUPLICATE — need a signed-in browser session (`403` otherwise). VERIFIED additionally requires the bug's fix task to be DONE (`409 FIX_TASK_NOT_DONE`).

## 18. Convergence

`POST /api/v1/features/{featureId}/convergence-runs`

`GET /api/v1/convergence-runs/{id}`

`POST /api/v1/convergence-findings/{id}/generate-task`

The completion gate only trusts a convergence verdict that is still current: if the approved requirements revision is no longer the one the run examined, or any in-scope task changed after the run completed, the gate reports `convergence_stale` (with the reason) and completion stays blocked until convergence runs again.

### Release status

`GET /api/v1/projects/{projectId}/features/release-status`

Every feature with its release-check verdict in one call (each feature is judged against its own linked requirements):

```json
{
  "features": [
    {
      "id": "...", "key": "FEAT-001", "title": "...", "description": "...", "status": "CONVERGENCE",
      "checked": true,
      "can_complete": false,
      "recommended": false,
      "blocking_findings": 1,
      "blocking_bugs": 0,
      "incomplete_tasks": 0,
      "no_tasks": false
    }
  ]
}
```

## 19. AI provider connections and profiles

### Create provider connection

`POST /api/v1/workspaces/{workspaceId}/ai/providers`

Write request may contain a credential value, but normal read responses return only secret metadata/redaction state.

```json
{
  "name": "My OpenAI-compatible gateway",
  "provider_type": "OPENAI_COMPATIBLE",
  "base_url": "https://gateway.example.com/v1",
  "credential": {"type": "BEARER", "value": "write-only-secret"},
  "timeout_ms": 120000
}
```

### Generic custom HTTP mapping

```json
{
  "provider_type": "CUSTOM_HTTP",
  "base_url": "https://ai.example.com",
  "custom_http_mapping": {
    "method": "POST",
    "path": "/generate",
    "request_json_template": {
      "model": "{{model}}",
      "messages": "{{messages}}"
    },
    "text_response_pointer": "/result/answer"
  }
}
```

Only documented variables/pointers are accepted. No arbitrary code/expression execution is allowed.

`provider_type` is one of `OPENAI`, `ANTHROPIC`, `GEMINI`, `OPENAI_COMPATIBLE`, `CUSTOM_HTTP`, `LOCAL_CLI`. `timeout_ms` accepts 1,000–1,800,000; the default is 240,000 for HTTP providers and 900,000 (15 minutes) for `LOCAL_CLI`.

### Local CLI connection

```json
{
  "name": "Claude Code on my laptop",
  "provider_type": "LOCAL_CLI",
  "base_url": "cli://machine/6f1c.../claude"
}
```

- `base_url` is the target: `cli://server/claude` or `cli://machine/<machine-uuid>/<claude|codex>`; anything else is `VALIDATION_ERROR`. No credential — the CLI uses its own login.
- A machine target may only be created by that machine's owner (and not for a revoked machine): otherwise `403`.
- A server target runs as the API server, so it is operator-only: a non-operator gets `403`, and an operator's connection is saved as a SYSTEM connection (`scope_type: "SYSTEM"`, `workspace_id: null`) even when created through the workspace route. It can later be re-pointed only by an operator.
- `cli://server/codex` is refused with `400 LOCAL_CLI_NOT_ALLOWED`: Codex's read-only sandbox stops writes, not reads, so on the server a prompt could make it read host files. Codex stays available on a user's own machine. Older rows with that target fail at run and test time with the same code.
- Server targets run only when the operator sets `SDD_ENABLE_LOCAL_CLI=true` (`LOCAL_CLI_DISABLED` otherwise). Machine targets go through the agent gateway (§22); `503 MACHINE_OFFLINE` if the machine's `sdd-agent` is not connected.
- The CLI runs with no tools, in a throwaway folder, prompt on stdin, filtered environment, hard timeout and a 4 MB output cap. Codex additionally runs with `--ignore-user-config` (no user MCP servers) and its plugins, apps and shell tool switched off; a Codex too old for that flag fails with `CLI_UNSUPPORTED_VERSION`.
- A profile on a `LOCAL_CLI` connection needs a plain model id (`^[A-Za-z0-9._:/-]{1,100}$`, not starting with `-`), checked on profile create/update (`VALIDATION_ERROR`) and again before the CLI starts (`CLI_INVALID_MODEL`).

### Where a CLI can run

`GET /api/v1/ai/cli`

```json
{
  "server": { "enabled": false, "operator_only": true, "can_create": false, "clis": [] },
  "machines": [
    {
      "id": "...", "name": "laptop", "platform": "win32", "online": true,
      "clis": [{ "id": "claude", "name": "Claude Code", "installed": true, "version": "2.1.0", "auth": "ok", "suggestedModels": ["sonnet", "opus", "haiku"] }]
    }
  ]
}
```

Only the caller's own non-revoked machines are listed; `clis` is what the connected daemon reported (`[]` when offline). `server.enabled` is the deployment flag; `server.can_create` is true only for an operator on a deployment with server CLIs enabled, and `server.clis` then lists only the tools allowed on the server (Claude Code).

### List provider models

`GET /api/v1/ai/providers/{providerId}/models` → `{ "models": [...] }`. For `LOCAL_CLI` it returns aliases instead of calling a provider: `["default", "sonnet", "opus", "haiku"]` for Claude Code, `["default"]` for Codex (`default` keeps the CLI's own model).

`POST /api/v1/ai/providers/models-preview` lists models of an HTTP provider for unsaved form data (`provider_type`, `base_url`, optional `credential`; workspace admins only). It does not apply to `LOCAL_CLI`, whose aliases come from `GET /api/v1/ai/cli` (`suggestedModels`).

### Test provider connection

`POST /api/v1/ai/providers/{providerId}/test`

Optional body `{ "model_id": "..." }` (a `LOCAL_CLI` test probes with `default`).

Response `{ ok, latencyMs, modelProbe }` or `{ ok: false, latencyMs, error, errorCode }`. A failure reports the HTTP status and the provider's error code only (`"Provider answered HTTP 401 (invalid_api_key)"`) — never text from the provider's body or a transport error naming addresses; the control plane's own messages (egress refusal, timeout, CLI errors) are kept.

### Create AI profile

`POST /api/v1/workspaces/{workspaceId}/ai/profiles`

```json
{
  "name": "Planning Deep",
  "provider_connection_id": "...",
  "model_id": "provider/model-name",
  "parameters": {"reasoning": "high"},
  "required_capabilities": ["structured_output"]
}
```

### Bind project AI role

`PUT /api/v1/projects/{projectId}/ai-role-bindings/{role}`

```json
{
  "ai_profile_id": "..."
}
```

Valid role values include `DISCOVERY`, `SPECIFICATION`, `ARCHITECTURE`, `TASK_DECOMPOSITION`, `REVIEW`, `CONVERGENCE`.

`PUT /api/v1/workspaces/{workspaceId}/ai-role-bindings/{role}` sets the workspace default the same way.

### Edit, disable and remove

Workspace admins with `ai:manage` change their workspace's rows; SYSTEM rows are operator-only. Every change is audited (`ai.provider.updated|disabled|enabled|deleted`, `ai.profile.updated|deleted`, `ai.role_binding.removed`) with field names only, never a secret.

- `PATCH /api/v1/ai/providers/{providerId}` — any of `name`, `base_url` (egress-checked; a `LOCAL_CLI` target must be a CLI target and, for a machine, the caller's own), `credential` (`{type, value}` replaces the key, `null` removes it, absent keeps it; not for `LOCAL_CLI`), `public_headers`, `secret_headers` (replaces the set), `timeout_ms`, `capabilities` (refused with 409 `AI_CAPABILITY_MISMATCH` if a profile still requires a dropped one), `custom_http_mapping`, `status` (`ACTIVE` | `DISABLED`). `provider_type` cannot change. A new endpoint or credential clears the last test result. Secrets are never returned. A `base_url` on a different origin (scheme, host or port — a native provider without a URL counts as its default origin) drops the stored credential and secret headers unless the same request sends them again; the response `{ connection, cleared_secrets }` lists what was dropped (`"credential"`, `"secret_headers"`), and the form should ask for them. A new path on the same origin keeps them.
- `DELETE /api/v1/ai/providers/{providerId}` → `{ deleted, profiles_removed }`. Refused with 409 `PROVIDER_IN_USE` while any role binding (workspace or project, in any workspace) uses one of its profiles; `details.bindings` lists `{role, scope, workspace_id, project_id, profile_id, profile_name}`. Unbound profiles are removed with it; generation history keeps its rows.
- `PATCH /api/v1/ai/profiles/{profileId}` — `name`, `model_id`, `parameters`, `status`. Bound roles keep pointing at the profile, so a new model applies to all of them. The connection cannot change.
- `DELETE /api/v1/ai/profiles/{profileId}` — refused with 409 `PROFILE_IN_USE` while bound.
- `DELETE /api/v1/workspaces/{workspaceId}/ai-role-bindings/{role}` and `DELETE /api/v1/projects/{projectId}/ai-role-bindings/{role}` remove one binding; the role then resolves from the next scope or runs without AI. 404 when nothing was bound.

A disabled connection or profile is skipped by resolution, so its roles use their fallback. `GET /workspaces/{id}/ai/providers` adds `usage: {profiles, bindings, roles[]}` per connection, `GET /workspaces/{id}/ai/profiles` adds `usage: {bindings[]}`, and `GET /workspaces/{id}/ai-role-bindings` adds `active: false` for a binding whose profile or connection is disabled.

### Resolve effective role profile

Resolution order is project override → workspace default → operator-managed system default. Workspace/project APIs cannot modify system-scoped provider connections/profiles.

`GET /api/v1/projects/{projectId}/ai-role-bindings`

Response identifies the effective profile and inheritance source without exposing credentials (nothing is decrypted to describe it). For members who are not workspace admins or operators, a binding on a SYSTEM connection shows only `{ id, scope_type, name, provider_type, status }` as its `provider` — the same rule that hides SYSTEM connections from their provider list.

### Generation attribution

`GET /api/v1/ai/generation-runs/{generationRunId}`

Returns provider/model/profile/status/timing and artifact linkage. A token needs `project:read` or `artifact:read`; a run that belongs to a project is authorized like the project (a project-narrowed token sees only its own project's runs), and a workspace-level run is refused to project-narrowed tokens.

## 20. CLI authentication

### Device/browser login start

`POST /api/v1/cli/auth/start`

### Poll/exchange

`POST /api/v1/cli/auth/exchange`

Exact auth implementation should follow the chosen identity solution.

A stale or foreign bearer token sent to `/auth/cli/start`, `/auth/cli/exchange` or `/agents/pairing/claim` is ignored (treated as anonymous) instead of failing the request with 401, so an expired saved token never locks the CLI out of signing in again.

## 21. Machine registration

`POST /api/v1/agents/machines/register`

`POST /api/v1/agents/machines/{id}/heartbeat`

### Pairing

`POST /api/v1/projects/{projectId}/pairing-code` (browser session, workspace admin) returns a single-use code that names the project and the permission ceiling (`MANUAL` | `ASSISTED` | `AUTO_RUN`).

`POST /api/v1/agents/pairing/claim` requires the claimer's own login (device-flow token or session; `401 PAIRING_LOGIN_REQUIRED` without one — `sddctl connect` runs the device flow first). The claimer must have write access to the project; the machine, repository link and the new machine-bound token belong to the claimer, not to the admin who created the code. The claimer may only request a lower mode than the code grants.

Self-connect codes are the exception. `GET /api/v1/projects/{projectId}/execution-prompt[?auto_approve=true]`, called from a browser session by someone with write access, embeds a single-use code (60-minute expiry) as `sddctl connect <code> --server <url>` and returns `connect_expires_at`. Claiming that code needs no login: it acts as the person who copied the prompt, even when the laptop has another saved sign-in. The ceiling is `MANUAL`, or `AUTO_RUN` when a project admin ticked auto-approve (`403` for anyone else; at claim time the creator must still be an admin). API tokens get the prompt with the `sddctl login` + `sddctl project link` steps instead. `GET /api/v1/projects/{projectId}/execution-prompt/options` returns `{ self_connect, auto_approve }`, which says what the caller may get.

### Repository links

`POST /api/v1/agents/repo-links` — create or refresh the link between one of the caller's machines and a project. `permission_mode` omitted keeps the current mode (`MANUAL` for a new link). API tokens may create or keep a link and may lower its mode, but can never set or raise `AUTO_RUN` (`403 AUTO_APPROVE_WEB_ONLY`) nor raise a link above its current mode (`403 PERMISSION_MODE_CEILING`); a machine-bound token acts only for its own machine. A browser session needs project admin to choose `AUTO_RUN`.

`PATCH /api/v1/agents/repo-links/{linkId}` — `{ "auto_approve": true | false }` (or `{ "permission_mode": ... }`, exactly one). Browser session and project admin only; every change is audited as `repository_link.permission_changed`. The web app offers two options per link:

| Option | Mode written | Effect |
|---|---|---|
| Auto-approve runs whose required checks pass | `AUTO_RUN` | The server records a SYSTEM approval when every required verification of a non-HUMAN_REQUIRED task passed, and may dispatch READY work to the machine's `sdd-agent`. |
| Human review | `MANUAL` (an existing `ASSISTED` link is left as is and also reads as human review) | Every submission waits for a reviewer; nothing is dispatched remotely. |

`GET /api/v1/agents/repo-links` — every link of the caller's machines with `project`, `auto_approve` and `can_change_mode` (true for project admins in a browser session).

## 22. Agent gateway

WebSocket endpoint concept:

`wss://host/api/v1/agent/connect`

Initial authenticated message:

```json
{
  "type": "hello",
  "machine_id": "...",
  "client_version": "...",
  "capabilities": {
    "agents": ["codex", "claude", "kiro"],
    "os": "linux"
  }
}
```

Server commands:

```json
{
  "type": "execute_task",
  "command_id": "...",
  "task_id": "TASK-084",
  "project_id": "...",
  "execution_profile": "codex-default"
}
```

Daemon acknowledgement:

```json
{
  "type": "command_ack",
  "command_id": "...",
  "accepted": true
}
```

Other server → daemon messages:

- `{ "type": "work_available", "project_id": "..." }` — sent to online machines with an ACTIVE `AUTO_RUN` link after an approval, requeue, unblock to READY, a task readied, or auto-approve switched on. The daemon, if idle, calls `POST /agents/machines/{id}/dispatch-next`; it also polls that endpoint while idle (15 s backing off to 5 min).
- `{ "type": "cancel_task", "task_id": "...", "run_id": "...", "reason": "..." }` — the run was cancelled, requeued or unblocked to READY. The daemon stops that run (the whole process tree, including a running verification command) and reports nothing further. A heartbeat answered with a lease error stops the run the same way.
- `execute_task` with `"resume_run_id"` — a human resumed a blocked daemon run; the daemon continues that run under its fresh lease instead of claiming. Resuming a daemon run is refused (`409 RESUME_NEEDS_MACHINE`) when its machine is offline or no longer auto-runs the project — unblock to READY instead.

AI jobs for `LOCAL_CLI` connections that target a machine (server → daemon, daemon → server `ai_result`, and `ai_capabilities` after `hello_ok`) are specified in `docs/10_MCP_CLI_PROTOCOL.md`. They carry a prompt and a tool name only — never a command line or a credential. Only the machine a job was sent to may answer it.

## 23. Browser realtime events

Topics:
- project task updates;
- task run events;
- review updates;
- agent connection updates.

Clients should treat realtime events as invalidation hints and re-fetch authoritative state when necessary.

## 24. Permission examples

| Operation | Required scope |
|---|---|
| task read | `task:read` |
| task claim | `task:execute` |
| report run | `run:write` |
| request review | `run:submit` |
| approve task | `review:approve` |
| create bug | `bug:write` |
| MCP read tools | equivalent read scopes |
| MCP mutation tools | equivalent mutation scopes |
