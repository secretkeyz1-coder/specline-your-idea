/**
 * UI reference mockups are AI output. Wherever one is shown it goes into an
 * iframe with sandbox="" (no scripts, opaque origin) and this CSP, which
 * forbids every network request — so a mockup can neither run code nor call
 * home, whatever the server-side sanitizer might have missed.
 */
// Stored screens carry the same meta (apps/api ux-shell.ts MOCKUP_CSP); a
// second, identical policy changes nothing, and this one always comes first.
const MOCKUP_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

export function framedMockup(html: string, opts: { theme?: "light" | "dark" } = {}): string {
  let out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${MOCKUP_CSP}`) : `${MOCKUP_CSP}${html}`;
  // Styled screens carry light and dark tokens; pin the one being previewed.
  if (opts.theme) {
    out = /<html[^>]*>/i.test(out)
      ? out.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs.replace(/\sdata-theme="[^"]*"/i, "")} data-theme="${opts.theme}">`)
      : out;
  }
  return out;
}

/**
 * The version of a screen the canvas edits, as the API computes it
 * (ux/ux-draft.ts screenBase): the newest history entry and how many there
 * are. Sent with a save, undo or restore; a screen changed meanwhile answers
 * 409 UX_SCREEN_CHANGED instead of being overwritten.
 */
export function screenBase(screen: { history?: Array<{ at: string }> }): string {
  const history = screen.history ?? [];
  return `${history[0]?.at ?? "-"}#${history.length}`;
}

/** Whether a finding refuses approval (findings stored before categories never did on their own: the API re-checks). */
export const blocksApproval = (f: { action?: string }) => f.action === "block";

/** Whether the scope the plan leaves out still waits for the person's confirmation. */
export function scopeToConfirm(ref: { count_conflict?: { uncovered: string[] }; uncovered_scope?: string[]; scope_confirmed_at?: string | null } | null | undefined): boolean {
  return Boolean(ref && (ref.count_conflict?.uncovered.length || ref.uncovered_scope?.length) && !ref.scope_confirmed_at);
}

/**
 * A screen being drawn, as the page watches it: the frame (the screen's shell
 * with an empty <main>), the sanitized content so far, and whether the drawing
 * is being checked. One object, changed field by field, so the canvas follows
 * the content without rebuilding its artboards.
 */
export interface LiveDraw {
  key: string | null;
  frame: string | null;
  content: string;
  checking: boolean;
}

/** Read a server-sent event stream to its end, one event (name and parsed data) at a time. */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    try {
      onEvent(event, JSON.parse(data.join("\n")));
    } catch {
      /* not JSON: nothing this page reads */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      dispatch(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

/**
 * A drawn screen whose drawing followed another layout reference (or none)
 * than it should now: its own, else the reference's. Mirrors layoutStale in
 * apps/api ux-layout.ts.
 */
export function layoutStale(
  reference: { layout_reference?: { digest: string } | null },
  screen: { layout_reference?: { digest: string }; drawn_with_layout?: string | null; html: string | null },
): boolean {
  if (!screen.html) return false;
  const effective = screen.layout_reference ?? reference.layout_reference ?? null;
  return (effective?.digest ?? null) !== (screen.drawn_with_layout ?? null);
}
