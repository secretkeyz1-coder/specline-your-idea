import { browser } from "$app/environment";
import type { UxDevice, UxPlatform } from "$lib/types.js";

/**
 * Artboard sizes on the UI-reference canvas: a real viewport, like a design
 * tool's frame presets. A screen is at least its frame tall and longer only
 * when its page scrolls.
 */
export const FRAMES = {
  laptop: { w: 1280, h: 800, label: "Laptop" },
  desktop: { w: 1440, h: 900, label: "Desktop" },
  fhd: { w: 1920, h: 1080, label: "Full HD" },
  qhd: { w: 2560, h: 1440, label: "QHD" },
} as const;
export type FrameKey = keyof typeof FRAMES;
export const MOBILE = { w: 390, h: 844, label: "Mobile" };

/** Native device sizes in Android dp (mirrors UX_DEVICES in @sdd/contracts). */
export const UX_DEVICES = {
  desktop: { w: 1440, h: 900, label: "Desktop" },
  phone: { w: 412, h: 915, label: "Phone" },
  "tablet-landscape": { w: 1280, h: 800, label: "Tablet landscape" },
  "tablet-portrait": { w: 800, h: 1280, label: "Tablet portrait" },
} as const;

/**
 * What one artboard is drawn at. A web reference uses the remembered desktop
 * preset and the 390 phone ("mobile"); a native one uses its devices' sizes.
 */
export type BoardDevice = "mobile" | UxDevice;

/**
 * How the canvas shows the screens. Web: "desktop" | "mobile" | "both".
 * Native: one of the reference's devices, or "all" of them side by side.
 */
export type CanvasView = "both" | "all" | BoardDevice;

/** The reference's platform, absent on older references: a web app. */
export const isNative = (platform: UxPlatform | null | undefined): platform is UxPlatform & { kind: "native-mobile" } =>
  platform?.kind === "native-mobile" && platform.devices.length > 0;

/** The view a reference opens on: web on the desktop, native on its primary device. */
export function defaultView(platform: UxPlatform | null | undefined): CanvasView {
  return isNative(platform) ? platform.devices[0]! : "desktop";
}

/** The boards one view shows, left to right. */
export function boardDevices(view: CanvasView, platform: UxPlatform | null | undefined): BoardDevice[] {
  if (isNative(platform)) {
    if (view === "all") return [...platform.devices];
    return platform.devices.includes(view as UxDevice) ? [view as UxDevice] : [platform.devices[0]!];
  }
  if (view === "both") return ["desktop", "mobile"];
  return view === "mobile" ? ["mobile"] : ["desktop"];
}

/** An artboard's size: the desktop preset for a web desktop board, else the device's own. */
export function boardSize(d: BoardDevice, frame: FrameKey): { w: number; h: number; label: string } {
  if (d === "mobile") return MOBILE;
  if (d === "desktop") return FRAMES[frame];
  return UX_DEVICES[d];
}

/** "Android · Tablet landscape, Phone" — what a reference is drawn as, in a few words. */
export function platformLabel(platform: UxPlatform | null | undefined): string {
  if (!isNative(platform)) return "Web app";
  return `Android · ${platform.devices.map((d) => UX_DEVICES[d].label).join(", ")}`;
}

/** Whether two platforms draw differently: another kind, or another primary device. */
export function platformDiffers(a: UxPlatform | null | undefined, b: UxPlatform | null | undefined): boolean {
  const kind = (p: UxPlatform | null | undefined) => (isNative(p) ? "native-mobile" : "web");
  if (kind(a) !== kind(b)) return true;
  return isNative(a) && isNative(b) && a.devices[0] !== b.devices[0];
}

const FRAME_KEY = "sdd-ux-frame";

/** The desktop preset this browser last chose. */
export function savedFrame(): FrameKey {
  try {
    const v = browser ? localStorage.getItem(FRAME_KEY) : null;
    return v && v in FRAMES ? (v as FrameKey) : "desktop";
  } catch {
    return "desktop";
  }
}

export function saveFrame(v: FrameKey): void {
  try {
    localStorage.setItem(FRAME_KEY, v);
  } catch {
    // A remembered preset is a convenience only.
  }
}
