import type { DbExecutor } from "@sdd/db";
import { UX_SCREEN_HISTORY, type UxReference, type UxScreen, type UxScreenVersion } from "@sdd/contracts";
import { DomainError, errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runText, UX_ELEMENT_STYLED_SYSTEM_PROMPT, UX_ELEMENT_SYSTEM_PROMPT, UX_NATIVE_ANDROID_RULES } from "@sdd/ai";
import { platformLines, platformOf } from "./ux-platform.js";
import { structuredOf } from "../artifact/service.js";
import { getProject } from "../project/service.js";
import { approvedDesignSystem, designSystemBrief } from "../design-system/service.js";
import { collapseIcons } from "./ux-icons.js";
import { sanitizeHtml } from "./ux-sanitize.js";
import { assembleScreen, ensureNodeIds, extractFragment, extractScreenContent, findElement, screenContent, wrapTables } from "./ux-shell.js";
import { lintOptionsFor, lintScreenHtml } from "./ux-lint.js";
import { applyStatusTones, draftStatusTones } from "./ux-status.js";
import { cleanOdStyles, extractOdBody } from "./ux-od.js";
import { odElementSystemPrompt, odSeedOf } from "./ux-od-prompt.js";
import { effectiveLayout, layoutReferenceLines } from "./ux-layout.js";
import { NEUTRAL_SPEC } from "./ux-shell.js";
import { MAX_HTML_BYTES, checkBase, currentDraft, drawnHtml, editableScreen, mutateDraft, pushHistory, reanchorComments, requirementTitles, sampleDataLines, screenLint, shellOf, stripDesignSystem, briefLines } from "./ux-draft.js";

/** Changing a drawn screen: canvas saves, undo and restore from its history, an AI change to one element, and checking it again. */

/**
 * Save page content edited on the canvas (text, links between screens). It is
 * treated like model output — sanitized, tables wrapped, ids kept, linted —
 * and framed again; the previous content goes onto the screen's undo history.
 */
export async function saveUxScreenContent(
  db: DbExecutor,
  input: { projectId: string; screenKey: string; content: string; note?: string; base?: string },
) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const before = structuredOf<UxReference>(draft);
  // The canvas saves the whole page content: saved over a newer version, it
  // would silently take back whatever changed meanwhile (an undo, an AI edit).
  const seen = before?.screens.find((s) => s.key === input.screenKey);
  if (seen) checkBase(seen, input.base);
  // od: the canvas sends the whole body (optionally led by its <style data-screen>); tokens and seed CSS are the platform's, never the client's.
  const od = before?.generator === "od";
  const badges = od ? "od" : "kit";
  const cleaned = od ? cleanOdStyles(wrapTables(sanitizeHtml(extractOdBody(input.content)))) : wrapTables(sanitizeHtml(extractScreenContent(input.content)));
  const tones = before ? draftStatusTones(before.sample_data?.statuses, drawnHtml(before, input.screenKey), badges) : [];
  const content = ensureNodeIds(applyStatusTones(cleaned, tones, badges).html);
  if (content.length < 50) throw errors.validation("The screen would be empty — undo the change instead");
  // Rendering takes a moment: check against the draft as read, store below.
  const lint = before ? await screenLint(content, before, input.screenKey, shell.spec(before, input.screenKey), shell.brand) : [];
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = editableScreen(current, input.screenKey);
    checkBase(screen, input.base);
    const html = assembleScreen({ content, spec: shell.spec(current, input.screenKey), brand: shell.brand, screens: current.screens, currentKey: screen.key, shell: current.shell, platform: current.platform, generator: current.generator });
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw errors.validation("The screen is too large to save");
    return {
      ...current,
      screens: current.screens.map((s) =>
        s.key === screen.key
          ? { ...s, html, lint, history: pushHistory(s, (input.note ?? "Edited on the canvas").slice(0, 160)), comments: reanchorComments(s.comments, screenContent(html)) }
          : s,
      ),
    };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)! };
}

/**
 * An earlier version's content as it is put back: sanitized again (versions
 * kept before the parser-based sanitizer were cleaned by a weaker one) and
 * numbered.
 */
const restoredContent = (content: string) => ensureNodeIds(sanitizeHtml(content));

/** A draft screen whose history can be taken back: drawn, or cleared with its drawing kept on the history. */
function historyScreen(current: UxReference, key: string): UxScreen {
  const screen = current.screens.find((s) => s.key === key);
  if (!screen) throw errors.notFound("UI reference screen", key);
  if (!screen.html && !screen.history?.length) throw errors.conflict("UX_SCREEN_NOT_DRAWN", "Draw this screen before editing it");
  return screen;
}

/**
 * Clear a screen's drawing and keep its plan — what it must show, the
 * requirements it serves, its overlays and states — so it is drawn again from
 * scratch. The drawing goes onto the undo history and can be brought back;
 * comments stay and find their elements again when the screen is redrawn.
 */
export async function clearUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string; base?: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = editableScreen(current, input.screenKey);
    checkBase(screen, input.base);
    const { lint: _lint, revision_note: _note, ...kept } = screen;
    return {
      ...current,
      screens: current.screens.map((s) => (s.key === screen.key ? { ...kept, html: null, history: pushHistory(screen, "Drawing cleared") } : s)),
    };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)! };
}

/** Put the screen's previous content back (one step). */
export async function undoUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string; base?: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const before = structuredOf<UxReference>(draft);
  const seen = before?.screens.find((s) => s.key === input.screenKey);
  if (seen) checkBase(seen, input.base);
  const restoring = seen?.history?.[0]?.content;
  const lintOfRestored = before && restoring ? await screenLint(restoredContent(restoring), before, input.screenKey, shell.spec(before, input.screenKey), shell.brand) : null;
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = historyScreen(current, input.screenKey);
    checkBase(screen, input.base);
    const [previous, ...rest] = screen.history ?? [];
    if (!previous) throw errors.conflict("UX_NOTHING_TO_UNDO", "There is no earlier version of this screen");
    const content = restoredContent(previous.content);
    const html = assembleScreen({ content, spec: shell.spec(current, input.screenKey), brand: shell.brand, screens: current.screens, currentKey: screen.key, shell: current.shell, platform: current.platform, generator: current.generator });
    // Checked before the write; if another undo won the race, fall back to the HTML lint.
    const lint =
      previous.content === restoring && lintOfRestored
        ? lintOfRestored
        : lintScreenHtml(content, current.fidelity ?? "neutral", lintOptionsFor(current, screen));
    return {
      ...current,
      screens: current.screens.map((s) => (s.key === screen.key ? { ...s, html, lint, history: rest, comments: reanchorComments(s.comments, screenContent(html)) } : s)),
    };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)! };
}

/** The note a restore leaves, now and as first worded. */
const RESTORE_NOTE = /^(?:Restore to|Restored) the version before "/;

/**
 * The history after restoring entry `index`: the current content becomes the
 * newest entry (so a restore can be taken back, which also stands in for
 * redo) and the restored entry leaves the list. Capped like any history.
 */
export function historyAfterRestore(history: UxScreenVersion[], index: number, currentContent: string, at: string): UxScreenVersion[] {
  const restored = history[index]!;
  // Restoring a restore names the original change, not a chain of restores
  // (a note cut at 160 characters has lost its closing quote).
  let change = restored.note;
  for (let prefix = RESTORE_NOTE.exec(change); prefix; prefix = RESTORE_NOTE.exec(change)) change = change.slice(prefix[0].length).replace(/"$/, "");
  const note = `Restore to the version before "${change}"`.slice(0, 160);
  return [{ content: currentContent, at, note }, ...history.filter((_, i) => i !== index)].slice(0, UX_SCREEN_HISTORY);
}

/**
 * Put any earlier version of a screen back (History → Restore). Unlike undo,
 * nothing is lost: the version being replaced goes onto the history.
 */
/**
 * The history entry a restore names: by its time (`at`, what the canvas
 * sends), or by position for older clients. Both given must agree — a
 * position alone could name another version once the history moved.
 */
export function historyIndex(history: UxScreenVersion[], ref: { index?: number; at?: string }): number {
  const index = ref.at !== undefined ? history.findIndex((v) => v.at === ref.at) : (ref.index ?? -1);
  if (index < 0 || !history[index]) throw errors.notFound("Earlier version", ref.at ?? String(ref.index));
  if (ref.at !== undefined && ref.index !== undefined && ref.index !== index) {
    throw errors.conflict("UX_SCREEN_CHANGED", "The screen's history changed since you opened it — it was reloaded; choose the version again");
  }
  return index;
}

export async function restoreUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string; index?: number; at?: string; base?: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const before = structuredOf<UxReference>(draft);
  const seen = before?.screens.find((s) => s.key === input.screenKey);
  if (seen) checkBase(seen, input.base);
  const restoring = seen?.history ? seen.history[historyIndex(seen.history, input)]?.content : undefined;
  const lintOfRestored = before && restoring ? await screenLint(restoredContent(restoring), before, input.screenKey, shell.spec(before, input.screenKey), shell.brand) : null;
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = historyScreen(current, input.screenKey);
    checkBase(screen, input.base);
    const history = screen.history ?? [];
    const index = historyIndex(history, input);
    const version = history[index]!;
    const content = restoredContent(version.content);
    const html = assembleScreen({ content, spec: shell.spec(current, input.screenKey), brand: shell.brand, screens: current.screens, currentKey: screen.key, shell: current.shell, platform: current.platform, generator: current.generator });
    // Checked before the write; if the history moved meanwhile, fall back to the HTML lint.
    const lint =
      version.content === restoring && lintOfRestored
        ? lintOfRestored
        : lintScreenHtml(content, current.fidelity ?? "neutral", lintOptionsFor(current, screen));
    // A cleared screen has no drawing to keep: the restored entry just leaves the history.
    const nextHistory = screen.html
      ? historyAfterRestore(history, index, screenContent(stripDesignSystem(screen.html)), new Date().toISOString())
      : history.filter((_, i) => i !== index);
    return {
      ...current,
      screens: current.screens.map((s) =>
        s.key === screen.key ? { ...s, html, lint, history: nextHistory, comments: reanchorComments(s.comments, screenContent(html)) } : s,
      ),
    };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)! };
}

/** The largest selected part an element edit sends to the model; bigger parts are redrawn with the screen. */
const MAX_ELEMENT_CHARS = 30_000;

/**
 * Change one element of a drawn draft screen with AI: the model gets the page
 * for context and returns a replacement for that element only, which is put
 * in place, sanitized, numbered, checked and framed like any edit. The
 * previous content goes onto the screen's undo history.
 */
export async function editUxElement(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; screenKey: string; nid: string; instruction: string },
) {
  const project = await getProject(db, input.projectId);
  const { artifact, draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const before = structuredOf<UxReference>(draft);
  const screen = before?.screens.find((s) => s.key === input.screenKey);
  if (!before || !screen) throw errors.notFound("UI reference screen", input.screenKey);
  if (!screen.html) throw errors.conflict("UX_SCREEN_NOT_DRAWN", "Draw this screen before editing it");
  const instruction = input.instruction.trim().slice(0, 2000);
  if (instruction.length < 3) throw errors.validation("Say what to change");

  const content = screenContent(screen.html);
  const found = findElement(content, input.nid);
  if (!found) throw errors.notFound("Element", input.nid);
  const part = content.slice(found.start, found.end);
  if (part.length > MAX_ELEMENT_CHARS) {
    throw errors.validation("This part is too large to change on its own — select a smaller part, or redraw the screen with this change");
  }

  const styled = before.fidelity === "styled";
  const ds = styled ? await approvedDesignSystem(db, input.projectId) : null;
  const layout = effectiveLayout(before, screen);
  if (styled && !ds && !(layout?.mode === "adapt" && layout.design_system)) {
    throw errors.conflict("DESIGN_SYSTEM_NOT_APPROVED", "The design system these screens use is no longer approved — approve it again, or plan neutral screens");
  }
  // What the screen is for travels with every change, so a local edit cannot drift from the spec.
  const titles = await requirementTitles(db, input.projectId);
  const overlays = screen.overlays ?? [];
  const od = before.generator === "od";
  const badges = od ? "od" : "kit";
  const activeSpec = shell.spec(before, input.screenKey);
  const request = [
    `PROJECT: ${project.name}`,
    ...(before.brief ? ["", ...briefLines(before.brief)] : []),
    "",
    `SCREEN: ${screen.name} (${screen.screen_type ?? "screen"}) — ${screen.purpose}`,
    `SERVES REQUIREMENTS: ${screen.requirement_keys.map((k) => (titles.get(k) ? `${k} ${titles.get(k)}` : k)).join("; ") || "(none listed)"}`,
    "KEY ELEMENTS OF THE MAIN VIEW (keep each, and its data-key-element marker):",
    ...(screen.key_elements.length ? screen.key_elements.map((e, i) => `${i + 1}. ${e}`) : ["(none listed)"]),
    ...(overlays.length ? [od ? "OVERLAYS (frames in the data-sdd-overlays section):" : "OVERLAYS (drawn in ds-overlays):", ...overlays.map((o) => `- ${o.kind}: ${o.name}${o.purpose ? ` — ${o.purpose}` : ""}`)] : []),
    ...(screen.layout_note ? [`COMPOSITION PLAN: ${screen.layout_note}`] : []),
    ...(before.sample_data ? ["", ...sampleDataLines(before.sample_data).map((l) => (od ? l.replace(/\bds-badge\b/g, "badge") : l))] : []),
    // od: the design system and the seed's classes travel in the system prompt.
    ...(styled && !od ? ["", designSystemBrief(activeSpec, { mockupClasses: true })] : []),
    ...(layout ? layoutReferenceLines(layout, "draw") : []),
    ...(od ? [] : platformLines(platformOf(before), UX_NATIVE_ANDROID_RULES)),
    "",
    "THE WHOLE PAGE (context only — do not return it):",
    collapseIcons(content).slice(0, 40_000),
    "",
    "PART TO CHANGE:",
    collapseIcons(part),
    "",
    `CHANGE REQUESTED BY THE PERSON: ${instruction}`,
  ].join("\n");
  const result = await runText(gateway, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    artifactId: artifact.id,
    role: "ARCHITECTURE",
    system: od
      ? odElementSystemPrompt(odSeedOf(before, screen, activeSpec), styled ? activeSpec : null)
      : styled
        ? UX_ELEMENT_STYLED_SYSTEM_PROMPT
        : UX_ELEMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: request }],
  });
  const raw = extractFragment(result.text);
  if (raw === null) throw new DomainError("AI_OUTPUT_INVALID", "The model returned more than the selected part — try again", 502);
  const tones = draftStatusTones(before.sample_data?.statuses, drawnHtml(before, input.screenKey), badges);
  const fragment = applyStatusTones(wrapTables(sanitizeHtml(raw)).trim(), tones, badges).html;
  if (!fragment) throw new DomainError("AI_OUTPUT_INVALID", "The model returned nothing for this part — try again", 502);

  const next = ensureNodeIds(content.slice(0, found.start) + fragment + content.slice(found.end));
  // The element to select afterwards: the first one where the part was.
  const nid = /\bdata-nid="(n\d+)"/.exec(next.slice(found.start))?.[1] ?? null;
  const lint = await screenLint(next, before, input.screenKey, shell.spec(before, input.screenKey), shell.brand);
  const revision = await mutateDraft(db, draft.id, (current) => {
    const target = editableScreen(current, input.screenKey);
    // Another edit landed meanwhile: applying this one would drop it.
    if (screenContent(target.html!) !== content) throw errors.conflict("UX_SCREEN_CHANGED", "The screen changed while the AI was working — try again");
    const html = assembleScreen({ content: next, spec: shell.spec(current, input.screenKey), brand: shell.brand, screens: current.screens, currentKey: target.key, shell: current.shell, platform: current.platform, generator: current.generator });
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw errors.validation("The screen would be too large — ask for a simpler change");
    return {
      ...current,
      screens: current.screens.map((s) =>
        s.key === target.key
          ? { ...s, html, lint, history: pushHistory(s, `AI change to ${found.tag}: ${instruction}`.slice(0, 160)), comments: reanchorComments(s.comments, screenContent(html)) }
          : s,
      ),
    };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)!, nid };
}

/**
 * Check a drawn screen again (HTML lint and render check) and store the
 * findings — no AI call. For screens drawn before a check existed, and after
 * the kit or shell changed.
 */
export async function checkUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const before = structuredOf<UxReference>(draft);
  const target = before?.screens.find((s) => s.key === input.screenKey);
  if (!before || !target) throw errors.notFound("UI reference screen", input.screenKey);
  if (!target.html) throw errors.conflict("UX_SCREEN_NOT_DRAWN", "Draw this screen before checking it");
  const content = screenContent(target.html);
  const lint = await screenLint(content, before, input.screenKey, shell.spec(before, input.screenKey), shell.brand);
  const revision = await mutateDraft(db, draft.id, (current) => {
    const seen = editableScreen(current, input.screenKey);
    if (seen.html !== target.html) throw errors.conflict("UX_SCREEN_CHANGED", "The screen changed while it was being checked — check it again");
    // Store the same current shell/seed that the render check inspected.
    const html = assembleScreen({ content, spec: shell.spec(current, input.screenKey), brand: shell.brand, screens: current.screens, currentKey: target.key, shell: current.shell, platform: current.platform, generator: current.generator });
    return { ...current, screens: current.screens.map((s) => (s.key === input.screenKey ? { ...s, html, lint } : s)) };
  });
  return { revision, screen: structuredOf<UxReference>(revision)!.screens.find((s) => s.key === input.screenKey)! };
}
