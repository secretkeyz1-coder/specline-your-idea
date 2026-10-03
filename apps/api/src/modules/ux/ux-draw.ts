import type { DbExecutor } from "@sdd/db";
import { UX_BUDGETS, UxSampleDataSchema, type UxSampleData, type UxFidelity, type UxReference } from "@sdd/contracts";
import { DomainError, errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, runText, UX_NATIVE_ANDROID_RULES, UX_SAMPLE_DATA_SYSTEM_PROMPT, UX_SCREEN_STYLED_SYSTEM_PROMPT, UX_SCREEN_SYSTEM_PROMPT } from "@sdd/ai";
import { structuredOf } from "../artifact/service.js";
import { approvedDesignSystem, designSystemBrief } from "../design-system/service.js";
import { collapseIcons } from "./ux-icons.js";
import { sanitizeHtml } from "./ux-sanitize.js";
import { NEUTRAL_SPEC, assembleScreen, ensureNodeIds, extractScreenContent, partialScreenContent, screenContent, tidyContent, wrapTables } from "./ux-shell.js";
import { expandIcons } from "./ux-icons.js";
import { acceptScreenRepair, lintRepairInstruction } from "./ux-lint.js";
import { repairTargets } from "./ux-rules.js";
import { applyStatusTones, draftStatusTones } from "./ux-status.js";
import { effectiveLayout, layoutReferenceLines, layoutStale, templateDesignSystem } from "./ux-layout.js";
import { platformLines, platformOf } from "./ux-platform.js";
import { generationTracker } from "./ux-generation.js";
import { cleanOdStyles, extractOdBody, partialOdBody } from "./ux-od.js";
import { odRepairDraft, odScreenPrompt } from "./ux-od-prompt.js";
import { MAX_HTML_BYTES, currentDraft, drawnHtml, mutateDraft, planningContext, pushHistory, reanchorComments, sampleDataLines, screenLint, stripDesignSystem, briefLines } from "./ux-draft.js";

/** Drawing one screen with AI: the shared example data, the request, one repair turn, status tones and the frame. */

/** Drawings longer than this skip the lint repair turn: the prompt would carry the whole draft back. */
const MAX_REPAIR_CHARS = 60_000;
/** How often the live preview sends the drawing so far (it is re-sanitized each time). */
const PREVIEW_INTERVAL_MS = 350;

/**
 * The live preview of a screen being drawn, for a page that watches it:
 * `frame` is the screen's shell with an empty <main> (sent once, before the
 * model starts), `content` the sanitized content of <main> so far, and
 * `phase: "checking"` says the drawing is complete and being checked (the
 * stored screen can still differ: a repair turn may replace it).
 */
export type UxDrawPreview = { type: "frame"; html: string } | { type: "content"; html: string } | { type: "phase"; phase: "checking" };

/** Sheets being written, by draft: screens drawn at the same time wait for the same one. */
const pendingSheets = new Map<string, Promise<UxSampleData | undefined>>();

/**
 * The draft's shared example data. A draft planned before plans carried it
 * gets one written now (one AI call, once per draft) and stored on the draft.
 * A failed call leaves the screen to draw without it.
 */
async function ensureSampleData(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { ctx: Awaited<ReturnType<typeof planningContext>>; artifactId: string; draftId: string; reference: UxReference },
): Promise<UxSampleData | undefined> {
  if (input.reference.sample_data) return input.reference.sample_data;
  const pending = pendingSheets.get(input.draftId);
  if (pending) return pending;
  const job = (async () => {
    try {
      const result = await runStructured(gateway, {
        workspaceId: input.ctx.project.workspaceId,
        projectId: input.ctx.project.id,
        artifactId: input.artifactId,
        role: "ARCHITECTURE",
        schema: UxSampleDataSchema,
        schemaName: "UxSampleData",
        system: UX_SAMPLE_DATA_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [input.ctx.text, "", "SCREENS OF THE REFERENCE:", ...input.reference.screens.map((s) => `- ${s.name}: ${s.purpose}`)].join("\n"),
          },
        ],
      });
      const sheet = result.data;
      // A sheet stored meanwhile (another tab, another draw) wins: every screen draws with the stored one.
      const saved = await mutateDraft(db, input.draftId, (current) => (current.sample_data ? current : { ...current, sample_data: sheet }));
      return structuredOf<UxReference>(saved)?.sample_data ?? sheet;
    } catch {
      return undefined;
    } finally {
      pendingSheets.delete(input.draftId);
    }
  })();
  pendingSheets.set(input.draftId, job);
  return job;
}

/** Generate (or regenerate with a requested change) one screen of the current draft. */
export async function generateUxScreen(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; screenKey: string; instruction?: string; onPreview?: (event: UxDrawPreview) => void },
) {
  const ctx = await planningContext(db, input.projectId);
  const { artifact, draft } = await currentDraft(db, input.projectId);
  const reference = structuredOf<UxReference>(draft);
  const screen = reference?.screens.find((s) => s.key === input.screenKey);
  if (!reference || !screen) throw errors.notFound("UI reference screen", input.screenKey);

  const styled = reference.fidelity === "styled";
  const ds = styled ? await approvedDesignSystem(db, input.projectId) : null;
  const layout = effectiveLayout(reference, screen);
  if (styled && !ds && !(layout?.mode === "adapt" && layout.design_system)) {
    throw errors.conflict("DESIGN_SYSTEM_NOT_APPROVED", "The design system these screens use is no longer approved — approve it again, or plan neutral screens");
  }
  // Neutral screens use the same kit with a greyscale wireframe spec, so both
  // fidelities share one vocabulary, one shell and one set of layout rules.
  const spec = styled ? templateDesignSystem(ds?.spec ?? NEUTRAL_SPEC, layout) : NEUTRAL_SPEC;
  const fidelity: UxFidelity = styled ? "styled" : "neutral";
  const overlays = screen.overlays ?? [];
  // The screen's own layout reference, else the reference's: layout only, after the look.

  const sheet = reference.applicable ? await ensureSampleData(gateway, db, { ctx, artifactId: artifact.id, draftId: draft.id, reference }) : undefined;
  const others = reference.screens.filter((s) => s.key !== screen.key).map((s) => `- ${s.name}: ${s.purpose}`);
  // Icons go back to the placeholders the model writes: shorter, and its own vocabulary.
  // A changed template is a new composition, not a patch constrained by the
  // old drawing's geometry. Requirements and shared data still accompany it.
  const current = input.instruction && screen.html && !layoutStale(reference, screen) ? collapseIcons(screenContent(stripDesignSystem(screen.html))).slice(0, 40_000) : null;
  // open-design style (every reference planned since its adoption): the model writes the whole body from a seed.
  const od = reference.generator === "od";
  const odPrompt = od
    ? odScreenPrompt({ ref: reference, screen, spec: styled ? spec : null, projectText: ctx.text, sample: sheet, layout, current, instruction: input.instruction })
    : null;
  const request = odPrompt ? odPrompt.user : [
    ctx.text,
    "",
    // The product brief comes before the design system: what the screens are for decides how they are composed.
    ...(reference.brief ? [...briefLines(reference.brief), ""] : []),
    ...(styled ? [designSystemBrief(spec, { mockupClasses: true }), ""] : []),
    // A native mobile reference: the Android rules replace the web parts of the screen rules.
    ...platformLines(platformOf(reference), UX_NATIVE_ANDROID_RULES),
    ...(layout ? [...layoutReferenceLines(layout, "draw"), ""] : []),
    "OTHER SCREENS IN THIS REFERENCE (the platform's navigation lists them; keep names, people and data consistent with them):",
    ...(others.length ? others : ["(none)"]),
    "",
    ...(sheet ? [...sampleDataLines(sheet), ""] : []),
    `SCREEN TO PRODUCE: ${screen.name} (${screen.key})`,
    `PURPOSE (the person's goal on this screen): ${screen.purpose}`,
    `SCREEN TYPE (a category of function, not a layout recipe): ${screen.screen_type ?? "choose the closest"}`,
    `SERVES REQUIREMENTS: ${screen.requirement_keys.join(", ") || "(none listed)"}`,
    "KEY ELEMENTS OF THE MAIN VIEW (all must appear; mark each with data-key-element=\"<its number>\"):",
    ...screen.key_elements.map((e, i) => `${i + 1}. ${e}`),
    ...(screen.primary_action?.label ? [`PRIMARY ACTION: ${screen.primary_action.label}${screen.primary_action.result ? ` — afterwards: ${screen.primary_action.result}` : ""}`] : []),
    "OVERLAYS (draw each in ds-overlays; the main view shows only what opens it):",
    ...(overlays.length
      ? overlays.map((o) => `- ${o.kind}: ${o.name}${o.purpose ? ` — ${o.purpose}` : ""}${o.result ? ` (afterwards: ${o.result})` : ""}`)
      : ["(none planned — add one only for a create/edit form or a destructive confirmation the key elements imply)"]),
    ...(screen.states?.length
      ? [`STATES (draw at most ${UX_BUDGETS.stateFrames} as frames — the ones a builder would most likely get wrong; the rest are described in the plan):`, ...screen.states.map((st) => `- ${st.state}${st.when ? ` (${st.when})` : ""}${st.response ? `: ${st.response}` : ""}`)]
      : []),
    ...(screen.layout_note ? [`COMPOSITION PLAN (from the plan — follow it unless the key elements need otherwise): ${screen.layout_note}`] : []),
    ...(current
      ? ["", "CURRENT VERSION OF THIS SCREEN (its <main> content):", current, "", `CHANGE REQUESTED BY THE PERSON: ${input.instruction}`, "Apply the change and keep everything else."]
      : input.instruction
        ? ["", `ALSO REQUESTED BY THE PERSON: ${input.instruction}`]
        : []),
  ].join("\n");

  const system = odPrompt ? odPrompt.system : styled ? UX_SCREEN_STYLED_SYSTEM_PROMPT : UX_SCREEN_SYSTEM_PROMPT;
  // Model, limit, tokens, cut-offs, time and repair of this drawing, stored with it (aturan.md §5.7).
  const generation = generationTracker();
  let compactRetryUsed = false;
  const draw = async (content: string, onDelta?: (text: string) => void) => {
    const call = (request: string) => generation.call(() =>
      runText(gateway, { workspaceId: ctx.project.workspaceId, projectId: ctx.project.id, artifactId: artifact.id, role: "ARCHITECTURE", system, messages: [{ role: "user", content: request }], onDelta }),
    );
    try { return await call(content); }
    catch (error) {
      if (!(error instanceof DomainError) || error.code !== "AI_OUTPUT_TRUNCATED" || compactRetryUsed) throw error;
      compactRetryUsed = true;
      generation.repairRan();
      return call(`${content}\n\nThe previous response hit the output limit and was not saved. Return compact markup using the seed classes: no repeated shell/global CSS, no decorative filler, and state frames show only their changed content. Preserve all required fields, actions, markers, overlays and source permissions. Never omit a required element to fit the output budget.`);
    }
  };
  const readContent = (text: string) => (od ? cleanOdStyles(wrapTables(sanitizeHtml(extractOdBody(text)))) : wrapTables(sanitizeHtml(extractScreenContent(text))));
  // How a drawing is shown before it is framed: the kit's tidy rules, or (od) the body as it is with its icons drawn.
  const shown = (c: string) => (od ? expandIcons(c) : tidyContent(expandIcons(c)));
  const lintAll = (c: string) => screenLint(c, { ...reference, fidelity, sample_data: sheet }, screen.key, spec, ctx.project.name);
  const repairOpts = { sampleNames: sheet?.records.map((r) => r.name) };

  const preview = input.onPreview;
  let onDelta: ((text: string) => void) | undefined;
  if (preview) {
    // od: the frame is the document with its tokens and seed CSS and an empty body; content events carry the whole body so far.
    preview({ type: "frame", html: assembleScreen({ content: "", spec, brand: ctx.project.name, screens: reference.screens, currentKey: screen.key, shell: reference.shell, platform: reference.platform, generator: reference.generator }) });
    let sentAt = 0;
    let sent = "";
    onDelta = (text) => {
      const now = Date.now();
      if (now - sentAt < PREVIEW_INTERVAL_MS) return;
      sentAt = now;
      // The same cleaning a stored drawing gets, on what has arrived so far.
      const html = od
        ? shown(cleanOdStyles(wrapTables(sanitizeHtml(partialOdBody(text)))))
        : tidyContent(expandIcons(wrapTables(sanitizeHtml(partialScreenContent(text)))));
      if (html === sent) return;
      sent = html;
      preview({ type: "content", html });
    };
  }

  let content = readContent((await draw(request, onDelta)).text);
  if (preview) {
    // The last deltas may have fallen inside the interval: show the whole first drawing before checking it.
    preview({ type: "content", html: shown(content) });
    preview({ type: "phase", phase: "checking" });
  }
  let lint = await lintAll(content);
  // One repair turn when the drawing has findings a repair can fix — the way
  // the gateway repairs invalid JSON once. The repair is kept only when those
  // went down, it breaks no new approval rule and it lost no required content
  // (key elements, overlays, example records). A failed repair call keeps the
  // first drawing (the gateway has logged the failed run); what is left is
  // stored with the draft for the person to see.
  if (repairTargets(lint).length > 0 && content.length <= MAX_REPAIR_CHARS) {
    generation.repairRan();
    try {
      const repaired = readContent(
        (
          await draw(
            od
              ? `${request}\n\n${odRepairDraft(content)}\n\n${lintRepairInstruction(lint, "od")}`
              : `${request}\n\nYOUR DRAFT OF THIS SCREEN:\n<main class="ds-main">\n${content}\n</main>\n\n${lintRepairInstruction(lint)}`,
          )
        ).text,
      );
      const repairedLint = await lintAll(repaired);
      if (acceptScreenRepair({ content, findings: lint }, { content: repaired, findings: repairedLint }, repairOpts)) {
        content = repaired;
        lint = repairedLint;
      }
    } catch {
      // Keep the first drawing; its findings are stored with it.
    }
  }
  if (content.length < 200) {
    throw new DomainError("AI_OUTPUT_INVALID", "The model did not return the content of this screen — try again", 502);
  }
  // One status, one tone, on every screen (the sheet's list, or what the other screens already say).
  const badges = od ? "od" : "kit";
  content = applyStatusTones(content, draftStatusTones(sheet?.statuses, drawnHtml(reference, screen.key), badges), badges).html;
  content = ensureNodeIds(content);

  // The screen may have been removed while it was being drawn. The shell is
  // built from the latest screen list, so its navigation is current.
  const updated = await mutateDraft(db, draft.id, (latest) => {
    if (!latest.screens.some((s) => s.key === screen.key)) throw errors.notFound("UI reference screen", screen.key);
    const html = assembleScreen({ content, spec, brand: ctx.project.name, screens: latest.screens, currentKey: screen.key, shell: latest.shell, platform: latest.platform, generator: latest.generator });
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
      throw new DomainError("AI_OUTPUT_INVALID", "The generated screen is too large — ask for a simpler version", 502);
    }
    return {
      ...latest,
      screens: latest.screens.map((s) =>
        s.key === screen.key
          ? {
              ...s,
              html,
              lint,
              // Which layout reference this drawing followed: a later change shows it as out of date.
              drawn_with_layout: layout?.digest ?? null,
              generation: generation.record(),
              // A redraw can be undone like a manual edit.
              history: pushHistory(s, input.instruction ? `Redrawn by AI: ${input.instruction.slice(0, 120)}` : "Redrawn by AI"),
              // Elements are numbered afresh: comments follow what they were made on.
              comments: reanchorComments(s.comments, screenContent(html)),
              ...(input.instruction ? { revision_note: input.instruction.slice(0, 500) } : {}),
            }
          : s,
      ),
    };
  });
  return { revision: updated, screen: structuredOf<UxReference>(updated)!.screens.find((s) => s.key === screen.key)! };
}
