import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getUiTemplates } from "$lib/server/ui-templates.js";

export const GET: RequestHandler = async () => {
  try {
    return json({ templates: await getUiTemplates() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return json({ message: "The built-in template collection is unavailable. You can still bring your own HTML." }, { status: 503 });
  }
};
