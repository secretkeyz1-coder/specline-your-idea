# Architecture Decision Records

## ADR-001 — Web application is the control plane

**Decision:** The website/database is authoritative for planning, task state, run history and review.

**Rejected:** Use Git Markdown task checkboxes as the runtime database.

**Reason:** Concurrency, leases, audit, review and multi-agent state require transactional persistence.

---

## ADR-002 — Keep Markdown as portable artifact format

**Decision:** Requirements/design/tasks can be exported as Markdown/JSON.

**Reason:** Vendor neutrality and compatibility with local coding agents.

---

## ADR-003 — Use CLI plus MCP, not one or the other

**Decision:** Build `sddctl` as the primary local execution bridge and remote MCP as interoperability layer.

**Reason:** CLI controls local process/repository concerns; MCP standardizes AI tool semantics.

---

## ADR-004 — Use outbound WebSocket for remote local-agent dispatch

**Decision:** Optional daemon connects outbound to server.

**Rejected:** Public inbound HTTP server on user's laptop.

**Reason:** Easier NAT/firewall behavior and safer default trust boundary.

---

## ADR-005 — MCP is an adapter over domain services

**Decision:** MCP handlers call same application services as REST/CLI.

**Reason:** Prevent state-machine/auth drift.

---

## ADR-006 — Start with modular monolith

**Decision:** Bun + Elysia + TypeScript modular monolith for API, execution, MCP and agent gateway; SvelteKit + TypeScript for the web application.

**Rejected:** Microservices in MVP.

**Reason:** Domain is transaction-heavy and early operational boundaries are unknown. A TypeScript-first monorepo also allows contracts to be shared with the SvelteKit UI, CLI, MCP adapter and local daemon.

---

## ADR-006A — Drizzle ORM is the database access layer

**Decision:** Use Drizzle ORM + Drizzle Kit with PostgreSQL, using Bun SQL as the default Bun database driver unless deployment constraints require a different PostgreSQL driver.

**Reason:** Schema and query code stay TypeScript-native while preserving explicit SQL-oriented modeling and migration review.

---

## ADR-006B — Elysia is the Bun API framework

**Decision:** Use Elysia for the HTTP API and OpenAPI surface.

**Reason:** It is optimized for Bun, TypeScript-first, and keeps HTTP validation/contracts close to application code. Domain rules still live in application services, not route handlers.

---

## ADR-007 — PostgreSQL is primary runtime store

**Decision:** Use PostgreSQL for planning, tasks, graph edges, leases, runs, events and review.

**Reason:** Strong transaction/concurrency semantics and simpler MVP operations.

---

## ADR-008 — PostgreSQL-backed background jobs first

**Decision:** Avoid dedicated message broker in MVP.

**Reason:** Lower operational complexity. Introduce broker only if observed throughput/reliability needs justify it.

---

## ADR-009 — AI is not a source of authorization

**Decision:** All AI-generated actions are validated by deterministic code.

**Reason:** AI output can be wrong or manipulated.

---

## ADR-010 — Discovery precedes stack lock

**Decision:** Ask adaptive requirement questions before selecting stack.

**Reason:** Stack recommendation should follow problem constraints, not define them accidentally.

---

## ADR-011 — Tech stack has two top-level selection modes

**Decision:** AI Recommendation and Manual Selection.

Manual selection may ask AI for an individual unresolved layer while preserving locked user choices.

**Reason:** This matches the actual user decision and keeps the planning UX simple without losing partial AI assistance.

---

## ADR-012 — Bugs are separate domain entities

**Decision:** A bug is not a task status.

**Reason:** A task can be Running while a bug is discovered; a completed task may later cause a bug. The dimensions are distinct.

---

## ADR-013 — Implementer generally submits, reviewer accepts

**Decision:** Implementer transitions work to review; acceptance follows policy.

**Reason:** Prevent self-certified completion.

---

## ADR-014 — Feature completion requires convergence

**Decision:** Done tasks do not automatically mean complete feature.

**Reason:** Requirements can be missed even when planned tasks are all checked off.

---

## ADR-015 — Local daemon receives structured intent only

**Decision:** Server sends task/repo/agent IDs, not arbitrary shell commands.

**Reason:** Reduces command-injection/control-plane risk.

---

## ADR-016 — Manual prompt mode remains first-class

**Decision:** Copy/paste execution is permanently supported.

**Reason:** The platform must not depend on one protocol or coding-agent feature set.

---

## ADR-017 — Approved artifacts are immutable revisions

**Decision:** Changes create new revisions and downstream staleness.

**Reason:** Required for audit and task lineage.

---

## ADR-018 — Context is selected, not dumped

**Decision:** Build context packs from linked spec/design sections.

**Reason:** Lower token use and reduce conflicting irrelevant instructions.

---

## ADR-019 — Separate Provider Connection, AI Profile and AI Role Binding

**Decision:** Provider credentials/connectivity, model behavior, and project role routing are separate entities.

**Reason:** One provider may expose many models; one project may use different models for discovery/review; credentials should not be duplicated into role configuration.

---

## ADR-020 — Generic custom HTTP is declarative only

**Decision:** Custom provider mapping uses allowlisted request templates and response pointers, never arbitrary executable code.

**Reason:** Reduces injection/RCE risk and keeps behavior auditable/portable.

---

## ADR-021 — Open-source core requires no commercial tier gate

**Decision:** The core self-hosted application and reference UI do not model pricing tiers/upsell gating. Users may bring their own AI provider credentials.

**Reason:** The planned distribution is open-source and should remain useful when self-hosted.


## ADR-022 — Provider secrets use application-layer authenticated encryption

**Decision:** Provider credentials and secret headers are encrypted before PostgreSQL persistence using an instance master key supplied outside the database. Ciphertext records carry key-version metadata.

**Why:** Self-hosted users need a portable secret-storage baseline without making PostgreSQL itself the decryption authority, while keeping a migration path to external KMS/HSM systems.

**Guardrail:** Never auto-regenerate the master key on normal startup and never place it in exported project artifacts.
