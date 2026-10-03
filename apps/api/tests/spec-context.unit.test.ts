import { describe, expect, test } from "bun:test";
import type { AgentContextPack, DesignSystemSpec, TaskContract, UxScreen } from "@sdd/contracts";
import { designSystemEssentials, lineageNotes, relevantScreens, specStatusNote, stackLayerLines } from "../src/modules/prompt/spec-context.js";
import { renderConnectedCliPrompt, renderConnectedMcpPrompt, renderStandalonePrompt, specSections, specStatusSection } from "../src/modules/prompt/service.js";

const screen = (key: string, requirement_keys: string[]): UxScreen =>
  ({ key, name: key, purpose: `The ${key} screen`, requirement_keys, key_elements: ["Title", "Table"], states: [], overlays: [] }) as unknown as UxScreen;

const contract = (over: Partial<TaskContract> = {}): TaskContract =>
  ({
    acceptance_criteria: ["It works"],
    scope: { expected_paths: ["src/app"], forbidden_paths: [] },
    constraints: [],
    verification: { required: [{ type: "unit", command: "bun test" }] },
    deliverables: ["code"],
    stop_conditions: ["unclear"],
    ...over,
  }) as unknown as TaskContract;

const pack = (over: Partial<AgentContextPack> = {}): AgentContextPack => ({
  schema_version: 1,
  task: { id: "t1", key: "TASK-001", title: "Projects list", objective: "Build it", status: "READY", task_type: "frontend", contract: contract(), dependencies: [] },
  project: { id: "p1", key: "PRJ", name: "Project" },
  requirements: [],
  design_sections: [],
  project_rules: [],
  repository_instructions: null,
  dependency_outputs: {},
  ...over,
});

describe("spec status notes", () => {
  test("an approved artifact needs no note; a newer draft next to it is named as not binding", () => {
    expect(specStatusNote("design", { state: "approved", version: 3, newerDraft: null })).toBeNull();
    expect(specStatusNote("design", { state: "approved", version: 3, newerDraft: 4 })).toContain("v4 is an unapproved draft");
  });

  test("a required artifact that is a draft, stale or missing says stop — it is never embedded", () => {
    expect(specStatusNote("requirements", { state: "draft", version: 2 })).toContain("NOT APPROVED");
    expect(specStatusNote("stack", { state: "stale", version: 1 })).toContain("re-approve");
    expect(specStatusNote("design", { state: "none" })).toContain("Stop");
  });

  test("skipped optional artifacts say what to follow instead", () => {
    expect(specStatusNote("ux", { state: "none" })).toBe(
      "UI reference: skipped — follow the technical design and the design system (or the stack's defaults) for layout.",
    );
    expect(specStatusNote("design_system", { state: "none" })).toContain("Design system: skipped");
    expect(specStatusNote("ux", { state: "not_applicable", version: 1 })).toContain("not applicable");
    expect(specStatusNote("ux", { state: "stale", version: 2 })).toContain("stale");
  });
});

describe("lineage notes", () => {
  test("tasks cut from an older version are named, and the approved version wins", () => {
    const notes = lineageNotes([
      { kind: "design", approvedVersion: 4, outdated: [{ taskKey: "TASK-002", usedVersion: 3 }, { taskKey: "TASK-005", usedVersion: 3 }] },
      { kind: "stack", approvedVersion: 1, outdated: [] },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("2 tasks (TASK-002, TASK-005) were cut from Technical design v3; v4 is approved now");
  });

  test("a UI reference no longer approved at all is a change too", () => {
    const [note] = lineageNotes([{ kind: "ux", approvedVersion: null, outdated: [{ taskKey: "TASK-001", usedVersion: 2 }] }], { single: true });
    expect(note).toContain("This task was cut with UI reference v2, which is no longer approved");
  });
});

describe("relevant screens", () => {
  const screens = [screen("projects", ["FR-001"]), screen("settings", ["FR-009"]), screen("login", [])];

  test("a UI task gets the screens serving its requirements and any screen its contract names", () => {
    const picked = relevantScreens(screens, {
      taskType: "frontend",
      requirementKeys: ["FR-001"],
      contract: contract({ constraints: ["Layout follows docs/ui-reference/login.html"] }),
    });
    expect(picked.map((s) => s.key)).toEqual(["projects", "login"]);
  });

  test("a backend task on the same requirement gets no screen unless its contract names one", () => {
    expect(relevantScreens(screens, { taskType: "backend", requirementKeys: ["FR-001"], contract: contract() })).toEqual([]);
  });
});

describe("prompt sections", () => {
  test("stack layers carry their locked versions", () => {
    expect(stackLayerLines([{ category: "Frontend", technology: "SvelteKit", version: "2.x" }, { category: "Database", technology: "PostgreSQL", version: null }])).toEqual([
      "- Frontend: SvelteKit (2.x)",
      "- Database: PostgreSQL",
    ]);
  });

  test("design-system essentials list both palettes, fonts, shape and guidance", () => {
    const palette = { bg: "#ffffff", surface: "#fafafa", fg: "#111111", accent: "#16a34a" };
    const spec = {
      preset_id: "custom",
      name: "Forest",
      summary: "Calm",
      light: palette,
      dark: { ...palette, bg: "#000000" },
      fonts: { display: "Geist, sans-serif", body: "Geist, sans-serif", mono: "Fira Code, monospace" },
      radius: 8,
      density: "comfortable",
      depth: "hairline",
      border_width: 1,
      component_library: "daisyui",
      guidance: "Green means go.",
    } as unknown as DesignSystemSpec;
    const lines = designSystemEssentials(spec, 2).join("\n");
    expect(lines).toContain("**Forest** (v2)");
    expect(lines).toContain("- light: bg #ffffff, surface #fafafa, fg #111111, accent #16a34a");
    expect(lines).toContain("- dark: bg #000000");
    expect(lines).toContain("radius 8px");
    expect(lines).toContain("Green means go.");
  });

  test("the standalone work order embeds stack, design system, its screens and the spec status", () => {
    const p = pack({
      stack: { version: 2, layers: [{ category: "Frontend", technology: "SvelteKit", version: "2.x" }] },
      design_system: { version: 1, name: "Forest", brief: "DESIGN SYSTEM: Forest" },
      ui_reference: {
        version: 3,
        fidelity: "neutral",
        screens: [{ key: "projects", name: "Projects", file: "docs/ui-reference/projects.html", purpose: "List", requirement_keys: ["FR-001"], key_elements: ["Table"], behaviour: ['state "empty"'] }],
      },
      spec_notes: ["Design system: skipped — take visual styling from the stack's defaults."],
    });
    const out = renderStandalonePrompt(p);
    expect(out).toContain("## Spec status (read first)");
    expect(out).toContain("## Tech stack (locked, v2)");
    expect(out).toContain("- Frontend: SvelteKit (2.x)");
    expect(out).toContain("## Design system (v1)");
    expect(out).toContain("## UI reference screens for this task (v3)");
    expect(out).toContain("`docs/ui-reference/projects.html` — Projects: List");
    expect(out).toContain('behaviour to build and test: state "empty"');
    // Neutral mockups: styling comes from the design system, not the grey mockup.
    expect(out).toContain("component styling follow the design system");
  });

  test("an approved UI reference with no screen for this task says so", () => {
    expect(specSections(pack({ ui_reference: { version: 1, fidelity: "styled", screens: [] } }))).toContain("No screen of the approved UI reference belongs to this task.");
  });

  test("a screen task gets the app shell and its render check; a pack without them shows neither", () => {
    const screen = { key: "projects", name: "Projects", file: "docs/ui-reference/projects.html", purpose: "List", requirement_keys: [], key_elements: ["table"], behaviour: [] };
    const out = specSections(
      pack({
        ui_reference: { version: 2, fidelity: "neutral", screens: [screen], render_check: "RENDER CHECK (…): a Playwright test e2e/render/<screen key>.spec.ts" },
        app_shell: "APP SHELL (shared by every screen …): a side navigation",
      }),
    );
    expect(out).toContain("## Render check\nRENDER CHECK");
    expect(out).toContain("## Application shell\nAPP SHELL");
    expect(out).toContain("no full-screen wrapper");
    const bare = specSections(pack({ ui_reference: { version: 2, fidelity: "neutral", screens: [screen] } }));
    expect(bare).not.toContain("Render check");
    expect(bare).not.toContain("Application shell");
  });

  test("packs from older servers (no spec fields) still render without empty sections", () => {
    const out = renderStandalonePrompt(pack());
    expect(out).not.toContain("Spec status");
    expect(out).not.toContain("Tech stack (locked");
    expect(specStatusSection(pack())).toBe("");
  });

  test("connected prompts point at the pack's spec parts and repeat the spec status", () => {
    const p = pack({ spec_notes: ["Technical design: NOT APPROVED — v2 is a draft awaiting approval in the web app, so it is left out."] });
    for (const out of [renderConnectedCliPrompt(p), renderConnectedMcpPrompt(p)]) {
      expect(out).toContain("design system");
      expect(out).toContain("Spec status (read first):");
      expect(out).toContain("NOT APPROVED");
    }
  });
});
