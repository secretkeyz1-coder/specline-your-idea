import type { DbExecutor } from "@sdd/db";
import { UX_DEVICES, type UxDevice, type UxPlatform, type UxReference } from "@sdd/contracts";
import { getApprovedRevision } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { listStackComponents } from "../planning/stack.js";
import { getProject } from "../project/service.js";

/**
 * What a UI reference is drawn as: a web app (the web shell, desktop and
 * phone frames) or a native mobile app (Android, Material 3 chrome, phone and
 * tablet frames). Read from the approved stack and the requirements when the
 * plan is made; the person may override it. References made before platforms
 * existed have none and are web.
 */

/** Web, as every reference was before platforms existed. */
export const WEB_PLATFORM: UxPlatform = { kind: "web", os: null, devices: ["desktop", "phone"], source: "detected", reason: "" };

/** Stack technologies that make the screens a native mobile app. */
const NATIVE_TECH: Array<{ test: RegExp; name: string }> = [
  { test: /\breact[\s-]?native\b/i, name: "React Native" },
  { test: /\bexpo\b/i, name: "Expo" },
  { test: /\bflutter\b/i, name: "Flutter" },
  { test: /\bjetpack\s+compose\b|\bcompose\s+multiplatform\b/i, name: "Jetpack Compose" },
  { test: /\bkotlin\b/i, name: "Kotlin" },
];

/** The native UI framework the approved stack names ("React Native"), or null for a web stack. */
export function nativeFramework(stackLayers: Array<{ technology: string }>): string | null {
  for (const l of stackLayers) {
    const tech = NATIVE_TECH.find((t) => t.test.test(l.technology));
    if (tech) return tech.name;
  }
  return null;
}

/** Words in the requirements that ask for a tablet (a counter, a kitchen screen, a kiosk), English and Indonesian. */
const TABLET_WORDS = /\b(tablets?|ipad|pos|point[\s-]of[\s-]sale|kasir|cashier|kds|kitchen display|kiosk|kios)\b/gi;
/** Words that ask for a phone, English and Indonesian. */
const PHONE_WORDS = /\b(phones?|smartphones?|handphones?|hp|ponsel|mobile app|aplikasi mobile|android phone)\b/gi;
const PORTRAIT_WORDS = /\b(portrait|potret|tegak)\b/gi;

const found = (text: string, words: RegExp) => [...new Set([...text.matchAll(words)].map((m) => m[0]!.toLowerCase()))];

/**
 * The platform the stack and the requirements point to. Pure: the layers are
 * the approved stack's, the text is the idea, constraints and requirements.
 */
export function detectPlatform(stackLayers: Array<{ category: string; technology: string }>, requirementsText: string): UxPlatform {
  const native = stackLayers
    .map((l) => ({ layer: l, tech: NATIVE_TECH.find((t) => t.test.test(l.technology)) }))
    .find((x) => x.tech);
  if (!native) {
    return { ...WEB_PLATFORM, reason: "The approved stack is a web stack." };
  }
  const tablet = found(requirementsText, TABLET_WORDS);
  const phone = found(requirementsText, PHONE_WORDS);
  const portrait = found(requirementsText, PORTRAIT_WORDS);
  const devices: UxDevice[] = [];
  if (tablet.length) devices.push(portrait.length ? "tablet-portrait" : "tablet-landscape");
  if (phone.length) devices.push("phone");
  if (tablet.length && portrait.length && devices.length < 3) devices.splice(1, 0, "tablet-landscape");
  if (devices.length === 0) devices.push("phone");
  const words = [...tablet, ...phone, ...portrait].slice(0, 6).map((w) => `"${w}"`).join(", ");
  return {
    kind: "native-mobile",
    os: "android",
    devices: [...new Set(devices)].slice(0, 3),
    source: "detected",
    reason: `${native.layer.category}: ${native.tech!.name} in the approved stack${words ? `; the requirements mention ${words}` : "; no device named in the requirements, so phone"}.`.slice(0, 300),
  };
}

/** What the current approved stack and requirements suggest (web when nothing native is found or nothing is approved yet). */
export async function detectedPlatform(db: DbExecutor, projectId: string): Promise<UxPlatform> {
  const stack = await getApprovedRevision(db, projectId, "stack");
  if (!stack) return { ...WEB_PLATFORM, reason: "No stack is locked yet." };
  const [layers, project, req] = await Promise.all([
    listStackComponents(db, stack.revision.id),
    getProject(db, projectId),
    getApprovedRevision(db, projectId, "requirements"),
  ]);
  const reqs = req ? await listRequirementsForRevision(db, req.revision.id) : [];
  const text = [
    project.highLevelIdea,
    ...(project.constraints ?? []),
    ...reqs.flatMap((r) => [r.title, r.statement, ...r.acceptance_criteria.map((ac) => ac.statement)]),
  ].join("\n");
  return detectPlatform(layers, text);
}

/** A reference's platform: stored, or web for references made before platforms existed. */
export const platformOf = (ref: Pick<UxReference, "platform">): UxPlatform => ref.platform ?? WEB_PLATFORM;

export const isNative = (ref: Pick<UxReference, "platform">): boolean => platformOf(ref).kind === "native-mobile";

/** Same platform and devices (the reason and source don't change how screens are drawn). */
export function samePlatform(a: UxPlatform, b: UxPlatform): boolean {
  return a.kind === b.kind && (a.os ?? null) === (b.os ?? null) && a.devices.join() === b.devices.join();
}

export interface RenderSize {
  width: number;
  height: number;
  label: string;
}

/**
 * The two widths a screen is measured at: the narrowest and the widest
 * target device. Web keeps its historic 390 / 1440.
 */
export function renderSizes(platform: UxPlatform): { narrow: RenderSize; wide: RenderSize; minTarget: number } {
  if (platform.kind !== "native-mobile") {
    return { narrow: { width: 360, height: 800, label: "phone" }, wide: { width: 1280, height: 800, label: "desktop" }, minTarget: 32 };
  }
  const sizes = platform.devices.map((d) => ({ width: UX_DEVICES[d].w, height: UX_DEVICES[d].h, label: UX_DEVICES[d].label.toLowerCase() }));
  const byWidth = [...sizes].sort((a, b) => a.width - b.width);
  // 48dp touch targets on Android; a little slack for borders.
  return { narrow: byWidth[0]!, wide: byWidth[byWidth.length - 1]!, minTarget: 44 };
}

/** The devices in words: "tablet landscape (1280×800), phone (412×915)". */
export function deviceList(platform: UxPlatform): string {
  return platform.devices.map((d) => `${UX_DEVICES[d].label.toLowerCase()} (${UX_DEVICES[d].w}×${UX_DEVICES[d].h})`).join(", ");
}

/**
 * The platform block of a draw or element request: nothing for web (the
 * system prompt's web rules apply), the Android rules and the target devices
 * for a native app.
 */
export function platformLines(platform: UxPlatform, nativeRules: string): string[] {
  if (platform.kind !== "native-mobile") return [];
  return ["", `PLATFORM: an Android app (Material 3), not a web page. Target devices, primary first: ${deviceList(platform)}.`, nativeRules];
}
