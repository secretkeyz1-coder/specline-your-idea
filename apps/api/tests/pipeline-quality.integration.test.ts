import { describe, test, expect } from "bun:test";
import { createDb, schema } from "@sdd/db";
import { eq } from "drizzle-orm";
import { SecretBox } from "@sdd/shared";
import { RequirementsArtifactSchema, DesignArtifactSchema, TaskPlanSchema } from "@sdd/contracts";
import { generateTasks } from "../src/modules/task/generation.js";
import { refineDesign } from "../src/modules/planning/design.js";
import { generateUxScreen } from "../src/modules/ux/ux-draw.js";
import { checkUxScreen } from "../src/modules/ux/ux-edit.js";
import { closeRenderBrowser } from "../src/modules/ux/ux-render.js";
import { NEUTRAL_SPEC } from "../src/modules/ux/ux-shell.js";

const url = process.env.SDD_DELIVERY_TEST_DB;
(url ? describe : describe.skip)("pipeline quality on an isolated database", () => {
  test("semantic contradiction is repaired before READY; refine receives actual source baselines", async () => {
    const db = createDb(url!);
    let workspaceId = "", userId = "";
    let planCalls = 0, qualityCalls = 0, refining = false;
    let drawing = false, alwaysTruncated = false, drawCalls = 0, uxRevisionId = "", adapting = false;
    const source = "Members cannot delete records";
    const product = RequirementsArtifactSchema.parse({ summary: "Controlled records", actors: [{ name: "Member" }], workflows: [], functional_requirements: [{ key: "FR-001", title: "Deletion permission", statement: source, acceptance_criteria: [{ key: "AC-001-1", statement: source }] }] });
    const design = DesignArtifactSchema.parse({ overview: "Record permissions", architecture: { summary: "Bun application" }, components: [{ name: "Records", responsibility: "Implements FR-001" }], data_model: "Records have an id", api_contracts: "DELETE /records rejects Members with 403", state_machines: "Deletion is forbidden to Members", security: source, testing_strategy: "bun test tests/records.test.ts", deployment: "Production build and bounded smoke tests", requirement_coverage: [{ requirement_key: "FR-001", design_section: "security", status: "PATH_DEFINED" }], delivery_checks: [{ purpose: "build", command: "bun run build", expected_paths: ["package.json"], outcome: "Build succeeds" }, { purpose: "startup", command: "bun run test:smoke", expected_paths: ["tests/smoke.test.ts"], outcome: "App starts and stops" }, { purpose: "journey", command: "bun run test:journey", expected_paths: ["tests/journey.test.ts"], outcome: "Members are denied deletion" }] });
    const candidate = (correct: boolean) => TaskPlanSchema.parse({ features: [{ key: "records", title: "Records" }], tasks: [{ ref: "t1", title: "Bootstrap record permission service and tests", task_type: "code", feature_hint: "records", objective: "Provide a runnable record permission service", requirement_keys: ["FR-001"], acceptance_criterion_keys: ["AC-001-1"], scope: { expected_paths: ["src/records.ts", "package.json", "tests/smoke.test.ts", "tests/journey.test.ts"] }, acceptance_criteria: [correct ? source : "Allow every Member to remove records"], verification: { required: design.delivery_checks!.map(c => ({ command: c.command })) }, deliverables: ["implementation", "automated_tests"], stop_conditions: ["Approved permissions change"] }] });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const body = await request.json() as { messages: Array<{ role: string; content: string }> };
      const text = body.messages.map(m => m.content).join("\n");
      let answer: unknown;
      if (drawing) {
        if (adapting) { expect(text).toContain("TEMPLATE_STRUCTURE"); expect(text).toContain("TEMPLATE_VISUAL_CSS"); expect(text).not.toContain("OLD_TEMPLATE_DRAWING"); }
        drawCalls++;
        const [before] = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, uxRevisionId));
        expect((before!.structuredContent as any).screens[0].html ?? "").not.toContain("PARTIAL UNSAVED OUTPUT");
        const truncated = alwaysTruncated || drawCalls === 1;
        if (!truncated) { expect(text).toContain("previous response hit the output limit"); expect(text).toContain(source); }
        return Response.json({ choices: [{ message: { content: truncated ? "<div>PARTIAL UNSAVED OUTPUT" : `<div class="app app-min" data-sdd-app><main class="main" data-screen-content><section data-key-element="1"><h1>Record permissions</h1><p>${source}. This is a read-only records screen. No delete action is available to Members; unauthorized deletion requests are rejected by the server. The approved source permission remains unchanged.</p></section></main></div><section data-sdd-overlays></section>` }, finish_reason: truncated ? "length" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
      }
      if (refining) {
        expect(text).toContain("approved_requirements"); expect(text).toContain("approved_stack"); expect(text).toContain("Rules stay binding"); expect(text).toContain(source);
        answer = design;
      } else if (text.includes("Check the meaning of the proposed task plan")) {
        qualityCalls++;
        const corrected = text.includes("PROPOSED TASK PLAN:\n") && text.split("PROPOSED TASK PLAN:\n")[1]!.includes(`"acceptance_criteria":["${source}"]`);
        answer = { coverage: [{ requirement_key: "FR-001", acceptance_criterion_key: "AC-001-1", task_refs: ["t1"], status: corrected ? "CONSISTENT" : "CONTRADICTED", evidence: corrected ? "Task preserves denial" : "Task permits forbidden deletion" }], issues: [] };
      } else { planCalls++; answer = candidate(planCalls > 1); }
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    } });
    try {
      const suffix = crypto.randomUUID();
      const [user] = await db.insert(schema.users).values({ email: `${suffix}@example.test`, displayName: "Pipeline test" }).returning(); userId = user!.id;
      const [workspace] = await db.insert(schema.workspaces).values({ name: "Pipeline test", slug: suffix }).returning(); workspaceId = workspace!.id;
      const [project] = await db.insert(schema.projects).values({ workspaceId, key: "PIPELINE", name: "Controlled records", highLevelIdea: "Records", createdBy: userId, projectRules: ["Rules stay binding"] }).returning();
      let reqRevisionId = "", stackRevisionId = "";
      for (const [artifactType, content] of [["requirements", product], ["stack", { candidates: [] }], ["design", design]] as const) {
        const [artifact] = await db.insert(schema.artifacts).values({ projectId: project!.id, artifactType, title: artifactType }).returning();
        const [revision] = await db.insert(schema.artifactRevisions).values({ artifactId: artifact!.id, version: 1, checksum: suffix, structuredContent: content, status: "APPROVED", approvedAt: new Date(), approvedBy: userId }).returning();
        await db.update(schema.artifacts).set({ approvedRevisionId: revision!.id, currentDraftRevisionId: revision!.id }).where(eq(schema.artifacts.id, artifact!.id));
        if (artifactType === "requirements") reqRevisionId = revision!.id;
        if (artifactType === "stack") stackRevisionId = revision!.id;
      }
      const [r] = await db.insert(schema.requirements).values({ projectId: project!.id, artifactRevisionId: reqRevisionId, key: "FR-001", title: "Deletion permission", statement: source }).returning();
      await db.insert(schema.acceptanceCriteria).values({ requirementId: r!.id, key: "AC-001-1", statement: source });
      await db.insert(schema.stackComponents).values({ projectId: project!.id, stackRevisionId, category: "Backend", technology: "Bun", versionConstraint: "^1" });
      const box = SecretBox.fromMasterKey(new Uint8Array(32));
      const [connection] = await db.insert(schema.aiProviderConnections).values({ workspaceId, providerType: "OPENAI", name: "Fake pipeline provider", baseUrl: `http://127.0.0.1:${server.port}/v1`, encryptedCredentialRef: await box.encrypt("test-only") }).returning();
      const [profile] = await db.insert(schema.aiProfiles).values({ workspaceId, name: "Fake planner", providerConnectionId: connection!.id, modelId: "fake", parameters: { stream: false } }).returning();
      for (const role of ["TASK_DECOMPOSITION", "ARCHITECTURE"] as const) await db.insert(schema.aiRoleBindings).values({ workspaceId, role, aiProfileId: profile!.id });
      const gateway = { db, secretBox: box, allowPrivateEgress: true, maxResponseBytes: 1000000 };
      const generated = await generateTasks(gateway, db, { projectId: project!.id, userId });
      expect(planCalls).toBe(2); expect(qualityCalls).toBe(2); expect(generated.autoReadied).toBe(1);
      expect(generated.plan.tasks[0]!.acceptance_criteria).toEqual([source]);
      refining = true;
      const refined = await refineDesign(gateway, db, { projectId: project!.id, userId, section: "security", instructions: "Keep Member deletion forbidden" });
      expect(refined.revision.derivedFrom).toHaveLength(2);
      expect(refined.design.requirement_coverage[0]!.status).toBe("PATH_DEFINED");
      const [ux] = await db.insert(schema.artifacts).values({ projectId: project!.id, artifactType: "ux", title: "UX" }).returning();
      const [uxRevision] = await db.insert(schema.artifactRevisions).values({ artifactId: ux!.id, version: 1, checksum: suffix, status: "DRAFT", structuredContent: { applicable: true, generator: "od", fidelity: "neutral", sample_data: { records: [], people: [], notes: "" }, screens: [{ key: "records", name: "Records", purpose: "Read records", screen_type: "list", shell_mode: "standalone", requirement_keys: ["FR-001"], key_elements: [source], html: null }] } }).returning();
      uxRevisionId = uxRevision!.id;
      await db.update(schema.artifacts).set({ currentDraftRevisionId: uxRevisionId }).where(eq(schema.artifacts.id, ux!.id));
      drawing = true;
      const drawn = await generateUxScreen(gateway, db, { projectId: project!.id, userId, screenKey: "records" });
      expect(drawCalls).toBe(2); expect(drawn.screen.html).toContain(source); expect(drawn.screen.generation!.repaired).toBe(true);
      await db.update(schema.artifactRevisions).set({ structuredContent: { ...(drawn.revision.structuredContent as any), screens: [{ ...drawn.screen, html: drawn.screen.html!.replaceAll("flex:none", "flex:initial") }] } }).where(eq(schema.artifactRevisions.id, uxRevisionId));
      const checked = await checkUxScreen(db, { projectId: project!.id, screenKey: "records" });
      expect(checked.screen.html).toContain("flex:none");
      expect(checked.screen.html).toContain(source);
      const prior = checked.screen.html;
      alwaysTruncated = true;
      await expect(generateUxScreen(gateway, db, { projectId: project!.id, userId, screenKey: "records", instruction: "Keep permissions" })).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED" });
      expect(drawCalls).toBe(4);
      const [preserved] = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, uxRevisionId));
      expect((preserved!.structuredContent as any).screens[0].html).toBe(prior);
      const template = { name: "Blue template", mode: "adapt", digest: "new-template", analysed_at: new Date().toISOString(), source_chars: 80, brief: { archetype: "Records list", regions: [], patterns: [], density: "comfortable", components: [], kit_mapping: [] }, source_html: '<main class="template-list">…</main>', source_css: '.template-list{background:#ffffff}', design_system: { ...NEUTRAL_SPEC, name: "Template blue", light: { ...NEUTRAL_SPEC.light, accent: "#465fff" } } };
      await db.update(schema.artifactRevisions).set({ structuredContent: { ...(preserved!.structuredContent as any), fidelity: "styled", layout_reference: template, screens: [{ ...checked.screen, html: prior!.replace(source, "OLD_TEMPLATE_DRAWING"), drawn_with_layout: "old-template" }] } }).where(eq(schema.artifactRevisions.id, uxRevisionId));
      adapting = true; alwaysTruncated = false; drawCalls = 0;
      const adapted = await generateUxScreen(gateway, db, { projectId: project!.id, userId, screenKey: "records", instruction: "Follow the newly selected template, keeping permissions" });
      expect(adapted.screen.html).toContain("#465fff");
      expect(adapted.screen.drawn_with_layout).toBe("new-template");
    } finally {
      server.stop(true);
      await closeRenderBrowser();
      if (workspaceId) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.close();
    }
  }, 60000);
});
