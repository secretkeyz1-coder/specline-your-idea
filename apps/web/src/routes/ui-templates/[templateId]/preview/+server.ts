import type { RequestHandler } from "./$types.js";
import { readUiTemplate } from "$lib/server/ui-templates.js";

/** A screenshot, never executable template HTML. Session protection is in hooks. */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const { content } = await readUiTemplate(params.templateId, "preview");
    return new Response(new Uint8Array(content), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("Template preview unavailable", { status: 404 });
  }
};
