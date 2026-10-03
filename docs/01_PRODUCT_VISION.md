# Product Vision

## 1. Product statement

Agentic SDD Control Plane is a web application that helps a user turn a vague software idea into a controlled, traceable implementation plan that can be executed by AI coding agents.

The system must reduce the gap between:

> "I have an idea for an application."

and:

> "An AI agent has a bounded, testable work order and can prove what it changed."

## 2. Problem

AI coding agents are increasingly capable of editing repositories, running commands, and completing large implementation tasks. The weak point is often not code generation but **work definition and execution control**.

Common failure modes:

- vague initial prompts;
- missing requirements;
- architecture decisions made implicitly;
- task scopes too large;
- task dependencies not explicit;
- AI agents modify unrelated files;
- task status exists only in chat;
- agents mark work "done" without verification;
- bugs are mixed into normal task states;
- no durable relation between requirement, task, code diff and review;
- switching between coding agents loses planning context;
- local execution is hard to coordinate from a web planning tool.

## 3. Product goal

Create a system where planning and execution are explicitly connected:

```text
Intent
→ Specification
→ Design
→ Task
→ Execution
→ Evidence
→ Review
→ Acceptance
```

Every task should be traceable upward to a requirement and downward to one or more execution runs.

## 4. Primary users

### Solo builder
A developer or technical founder who wants AI to help transform an idea into a complete application.

### Technical project manager
A person who can define outcomes and review plans but may not want to manually decompose implementation work.

### Engineering lead
A person who wants architecture and task control while allowing multiple coding agents or developers to execute work.

### AI coding agent
A non-human worker that consumes a structured task contract and reports progress through CLI or MCP.

## 5. Jobs to be done

### Planning
"When I have only a high-level idea, help me discover missing details instead of immediately producing code."

### Stack decision
"After requirements are clear, either recommend a technically justified stack or let me lock the technologies I want."

### Task decomposition
"Turn an approved technical design into small tasks that can be executed independently and verified."

### Execution handoff
"Give me a prompt I can paste into my local coding agent, or let the agent fetch the work order directly."

### Project control
"Show me what is ready, running, blocked, under review, failed, buggy, or complete."

### Evidence
"For every completed task, show what files changed, what tests ran, and what review accepted the work."

## 6. Product principles

1. **Intent before implementation.**
2. **Clarify meaningful ambiguity before choosing technology.**
3. **Requirements are independent from implementation details.**
4. **Technology is a deliberate decision, not an agent accident.**
5. **One task should describe one bounded, verifiable outcome.**
6. **The implementer cannot unilaterally declare high-risk work accepted.**
7. **Operational state belongs in the database, not only in Markdown.**
8. **Agent integrations must be vendor-neutral.**
9. **Manual copy/paste must remain possible even when connected execution exists.**
10. **Local code should remain under the user's control.**
11. **Every automated action must be auditable.**
12. **A feature is complete only when implementation converges with the specification.**
13. **Planning AI is bring-your-own-provider:** users may configure supported provider APIs or safe custom endpoints; the core must not require one vendor.
14. **Open-source core remains fully functional without commercial tier gates.**

## 7. MVP definition

MVP is complete when a user can:

1. Configure or select an effective AI Provider Connection/Profile for planning, unless the self-host administrator already provides a default.
2. Create a project from a high-level idea.
3. Chat with a planning agent that asks adaptive clarification questions.
4. Approve a requirements baseline.
5. Choose a technology-selection mode:
   - AI recommendation; or
   - manual selection, with optional AI help for individual unresolved layers.
6. Generate a technical design.
7. Generate atomic tasks with dependencies.
8. Review and approve tasks.
9. Copy a self-contained prompt for any task.
10. Install and authenticate a local CLI.
11. Link a local repository to the web project.
12. Use the CLI to fetch/start/update/submit a task.
13. Allow an MCP-capable local agent to retrieve task context and report execution through the remote MCP adapter.
14. See task status and execution events update on the website.
15. Review a completed task and approve or request changes.
16. Record bugs separately from normal workflow state.
17. Run a convergence check before a feature is marked complete.



## 8. Out of scope for MVP

- cloud-hosted code execution;
- automatic GitHub pull request creation;
- distributed multi-agent scheduling across many machines;
- billing by tokens;
- community catalog/marketplace for execution-agent adapters/profiles;
- autonomous production deployments;
- IDE plugins;
- full enterprise SSO;
- complex organization policy inheritance.

These can be added after the execution model is stable.

## 9. Success metrics

### Planning quality
- percentage of projects reaching task generation without unresolved blocking questions;
- percentage of generated tasks accepted without manual re-splitting;
- average task readiness score.

### Execution quality
- task pass rate on first review;
- percentage of tasks with successful verification evidence;
- number of task reopens due to missing scope;
- number of concurrent claim conflicts safely prevented.

### Traceability
- percentage of tasks linked to acceptance criteria;
- percentage of done tasks with execution evidence;
- percentage of features passing convergence.

### Product usability
- time from idea creation to first READY task;
- time from copied task prompt to first status event;
- number of steps required to link a local repository.

## 10. Product boundary

The platform owns:
- planning;
- specification;
- task orchestration;
- execution metadata;
- review;
- status;
- audit.

The coding agent owns:
- repository inspection;
- code modification;
- local command execution;
- test execution;
- implementation summary.

The human owns:
- final intent;
- AI provider/model choice and credentials;
- permissions;
- high-risk approvals;
- policy overrides.
