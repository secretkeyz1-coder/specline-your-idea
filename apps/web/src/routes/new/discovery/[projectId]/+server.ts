import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";

/** Moved into the project notebook (its first chapter), so the spine stays visible. */
export const GET: RequestHandler = ({ params }) => redirect(308, `/projects/${params.projectId}/discovery`);
