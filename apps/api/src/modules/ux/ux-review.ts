import { createHash } from "node:crypto";
import type { DbExecutor } from "@sdd/db";
import { UxReviewAspect, UxVisualReviewSchema, type UxReference, type UxVisualReview } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { checkBase, currentDraft, editableScreen, mutateDraft } from "./ux-draft.js";
import { screenContent } from "./ux-shell.js";

/**
 * A person's visual review of a rendered screen (aturan.md §5.6): for each
 * aspect — focus, composition, hierarchy, product fit, devices and
 * consistency — fits, needs revision, or not checked yet, with the element at
 * fault and a concrete change. It informs the person's decision: it never
 * blocks approval and is never turned into a score.
 *
 * The review names the drawing it was made on (a digest of the screen's
 * content, node ids left out); a later drawing makes it outdated rather than
 * silently carrying it over.
 */

const ASPECTS = UxReviewAspect.options;

/** The §5.6 aspects with the question each answers, as aturan.md words them. */
export const REVIEW_ASPECT_LABELS: Record<UxReviewAspect, { aspect: string; question: string }> = {
  focus: { aspect: "Fokus", question: "Apakah pekerjaan utama dan aksi berikutnya langsung terlihat?" },
  composition: { aspect: "Komposisi", question: "Apakah susunan area mengikuti hubungan konten, bukan sekadar mengisi card?" },
  hierarchy: { aspect: "Hierarki", question: "Apakah informasi utama, pendukung, dan metadata mudah dibedakan?" },
  product_fit: { aspect: "Kesesuaian produk", question: "Apakah istilah, kepadatan, media, dan navigasi sesuai pengguna serta brief?" },
  devices: { aspect: "Perangkat dan konsistensi", question: "Apakah konten tetap terjangkau pada ukuran pendukung dan screen lain terasa satu produk?" },
};

/** One aspect as the person sends it: text fields may be left out. */
export type ReviewAspectInput = { aspect: UxReviewAspect; status: "ok" | "revise" | "unchecked"; element?: string; change?: string };

/** Digest of a screen's drawing as reviewed: its content, without the node ids a save renumbers. */
export function drawingDigest(storedHtml: string): string {
  return createHash("sha256").update(screenContent(storedHtml).replace(/\sdata-nid="[^"]*"/g, "")).digest("hex").slice(0, 64);
}

/**
 * The stored review from what the person sent: one entry per aspect in a
 * fixed order (missing ones "unchecked"), text trimmed, stamped with the time
 * and the drawing it describes.
 */
export function buildReview(aspects: ReviewAspectInput[], storedHtml: string, at = new Date()): UxVisualReview {
  const given = new Map(aspects.map((a) => [a.aspect, a]));
  return UxVisualReviewSchema.parse({
    aspects: ASPECTS.map((aspect) => {
      const a = given.get(aspect);
      return { aspect, status: a?.status ?? "unchecked", element: (a?.element ?? "").trim(), change: (a?.change ?? "").trim() };
    }),
    reviewed_at: at.toISOString(),
    html_digest: drawingDigest(storedHtml),
  });
}

/** Whether a stored review describes an earlier drawing than the one stored now. */
export function reviewOutdated(review: UxVisualReview | undefined, storedHtml: string | null): boolean {
  if (!review) return false;
  return !storedHtml || review.html_digest !== drawingDigest(storedHtml);
}

/** Store a person's visual review of a drawn draft screen (409 when the screen changed since it was opened). */
export async function reviewUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string; aspects: ReviewAspectInput[]; base?: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current: UxReference) => {
    const screen = editableScreen(current, input.screenKey);
    checkBase(screen, input.base);
    const review = buildReview(input.aspects, screen.html!);
    return { ...current, screens: current.screens.map((s) => (s.key === screen.key ? { ...s, visual_review: review } : s)) };
  });
  const screen = (revision.structuredContent as UxReference | null)?.screens.find((s) => s.key === input.screenKey);
  if (!screen?.visual_review) throw errors.internal("The review was not stored");
  return { revision, review: screen.visual_review };
}
