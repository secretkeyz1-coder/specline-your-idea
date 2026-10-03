import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";

/** Moved into the project workspace (so the project tabs stay visible). */
export const GET: RequestHandler = ({ params }) => redirect(308, `/projects/${params.projectId}/ux`);
