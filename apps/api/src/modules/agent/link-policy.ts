/**
 * Repository-link permission policy (docs/13 §10).
 *
 * The web app offers two choices per linked repository:
 *   - "Auto-approve runs whose required checks pass" → AUTO_RUN: the server may
 *     dispatch READY work to the machine's sdd-agent and records a SYSTEM
 *     approval when every required verification passed;
 *   - "Human review" → MANUAL (the schema default): nothing is dispatched
 *     remotely and every submission waits for a reviewer.
 * ASSISTED is kept for existing links and still reads as "Human review"; it is
 * never written by the two-option control.
 *
 * AUTO_RUN removes the human reviewer, so it is chosen only by a project admin
 * in a browser session. API tokens (device-flow CLI, pairing, machine) may
 * create or keep a link, and may lower its mode, but never set or raise AUTO_RUN.
 */

export type LinkPermissionMode = "MANUAL" | "ASSISTED" | "AUTO_RUN";

export const LINK_MODE_RANK: Record<LinkPermissionMode, number> = { MANUAL: 0, ASSISTED: 1, AUTO_RUN: 2 };

/** The two-option control: auto-approve on/off. */
export function modeForAutoApprove(autoApprove: boolean, current: LinkPermissionMode | null): LinkPermissionMode {
  if (autoApprove) return "AUTO_RUN";
  // Turning auto-approve off leaves a non-auto link as it is (MANUAL or ASSISTED).
  return current && current !== "AUTO_RUN" ? current : "MANUAL";
}

export function isAutoApprove(mode: string | null | undefined): boolean {
  return mode === "AUTO_RUN";
}

export type LinkModeDecision =
  | { ok: true; mode: LinkPermissionMode | null }
  | { ok: false; code: "AUTO_APPROVE_WEB_ONLY" | "PERMISSION_MODE_CEILING"; message: string };

/**
 * What mode a `POST /agents/repo-links` call may write. `mode: null` = leave
 * the stored mode alone (MANUAL for a new link).
 *  - tokens can never ask for AUTO_RUN;
 *  - tokens can never raise an existing link's mode (the pairing code or the
 *    web app set the ceiling); lowering is always allowed.
 */
export function decideLinkModeFromApi(input: {
  viaToken: boolean;
  current: LinkPermissionMode | null;
  requested: LinkPermissionMode | null | undefined;
}): LinkModeDecision {
  const requested = input.requested ?? null;
  if (!requested) return { ok: true, mode: null };
  if (!input.viaToken) return { ok: true, mode: requested };
  if (requested === "AUTO_RUN") {
    // Keeping an existing AUTO_RUN link is not a change.
    if (input.current === "AUTO_RUN") return { ok: true, mode: null };
    return {
      ok: false,
      code: "AUTO_APPROVE_WEB_ONLY",
      message:
        "Auto-approve can't be switched on from the CLI or an agent token. A project admin turns it on for this repository on the Machines page of the web app.",
    };
  }
  if (input.current && LINK_MODE_RANK[requested] > LINK_MODE_RANK[input.current]) {
    return {
      ok: false,
      code: "PERMISSION_MODE_CEILING",
      message: `This link is ${input.current}; a token can only keep or lower its permission mode. Change it in the web app instead.`,
    };
  }
  return { ok: true, mode: requested };
}
