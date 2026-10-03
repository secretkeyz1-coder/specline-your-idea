# Your first project

[Back to README](../../README.md) · [Getting started](getting-started.md)

Start with a narrow idea, for example: “A team can create a maintenance request, assign it, and mark it resolved.” Decide who uses it and what a successful journey looks like before adding features. Use a disposable target repository for your first execution experiment.

## Plan deliberately

1. **Create a project.** Describe the idea, actors, and constraints. Keep its project key handy for CLI linking.
2. **Complete discovery.** Answer the question bank; resolve blockers rather than treating completion as a formality. This path does not require AI.
3. **Prepare requirements.** Author them manually or use a configured AI profile. Review user-visible behavior, roles, failure paths, and acceptance criteria. Approve the requirements before the stack decision.
4. **Choose the stack.** Use a manual baseline or request an AI recommendation. Check hosting, platform, and dependency constraints rather than accepting a familiar stack automatically.
5. **Prepare technical design.** Describe components, data, API contracts, security, and testing. Specify executable delivery checks appropriate to the target repository, not guessed commands.
6. **Optionally add design system and UI reference.** Use them for visual consistency and approved screen intent. They are references, not evidence that the implemented application renders or works correctly. Non-UI projects can skip them.
7. **Prepare tasks.** Create manually or generate a plan. Check requirement coverage, dependencies, expected paths, deliverables, acceptance criteria, required checks, and stop conditions. Approvals and readiness checks can reject incomplete planning; resolve the reported condition instead of bypassing it.

Manual planning remains useful without a provider. AI generation is not a silent fallback to invented artifacts: unconfigured generation can return `AI_PROVIDER_NOT_CONFIGURED`. See [AI providers](ai-providers.md).

## Execute one task first

Read its work order, including scope and stop conditions. The simplest path is to copy the portable prompt from the task panel into your chosen coding agent and return actual progress/evidence to the app. For connected execution, use [CLI and agents](cli-and-agents.md) or [MCP](mcp.md). Keep initial repository permissions manual; automation is optional.

If a UI reference was approved, `sddctl ui pull` can bring reference exports into the linked target repository. Review resulting files; a reference does not replace functional tests or visual review.

When implementation is ready, run the specified checks and record their real commands, exit codes, and output summaries. Do not turn “not run” into “passed.” Block work when the spec is ambiguous, a dependency is missing, or the requested change is outside scope.

## Review and converge

Review the diff together with the approved task contract and run evidence. A workspace member can review; agents do not have approval authority. `AUTO_RUN` links can use the automated review policy for qualifying runs, so do not assume every approval involved a separate human.

Track defects as bugs with reproduction and expected/current behavior. Resolve them and run feature convergence before release approval. Passing a task test is not proof of startup, the whole user journey, accessibility, or production deployment. Exercise the actual application and retain evidence for the intended release scope.

For background on gates and artifacts, see [planning workflow](../04_PLANNING_WORKFLOW.md), [task specification](../11_TASK_SPECIFICATION.md), and [bug convergence](../22_BUG_CONVERGENCE.md).
