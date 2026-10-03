import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";
import { BAD_ID, formUuid, isUuid } from "$lib/server/ids.js";

type FetchFn = typeof globalThis.fetch;

/** Planning order after discovery: any of these means discovery is behind the project. */
const PAST_DISCOVERY = new Set([
  "REQUIREMENTS_DRAFT",
  "REQUIREMENTS_APPROVED",
  "STACK_SELECTION",
  "STACK_APPROVED",
  "DESIGN_DRAFT",
  "DESIGN_APPROVED",
  "TASK_GENERATION",
  "TASK_REVIEW",
  "EXECUTION_READY",
]);
/** The only lifecycles in which the page may ask the engine for questions on its own. */
const DISCOVERY_IN_PROGRESS = new Set(["IDEA_DRAFT", "DISCOVERY_ACTIVE"]);

async function requireProject(fetch: FetchFn, token: string | null, projectId: string) {
  try {
    return await api<{ project: { id: string; key: string; name: string; highLevelIdea: string; lifecycleStatus: string } }>(
      fetch,
      { token },
      "GET",
      `/api/v1/projects/${projectId}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(303, "/login");
    if (e instanceof ApiError && e.status !== 404) error(e.status, e.message);
    error(404, "Project not found");
  }
}

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  // Read-only on purpose: a GET load also runs on link hover (preload), so it
  // must never trigger a paid AI generation. The page requests the next batch
  // itself through the `next` action when it has nothing to show. Started
  // together with the project read; the project's answer (404, sign-in) still
  // decides first.
  const discoveryRead = api(fetch, session, "GET", `/api/v1/projects/${params.projectId}/discovery`).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const { project } = await requireProject(fetch, session.token, params.projectId);

  type Discovery = {
    session: {
      id: string;
      status: string;
      readiness: string;
      coverage: Record<string, { status: string; blocking: boolean }>;
      understanding: string;
    } | null;
    answered: Array<{ question: { id: string; questionText: string; topic: string }; answer: { answer: { text: string } } | null }>;
    pending: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
    facts: Array<{ id: string; factKey: string; value: string; sourceType: string }>;
    assumptions: Array<{ id: string; description: string; status: string }>;
    readiness: string;
  };
  let discovery: Discovery | null = null;
  const read = await discoveryRead;
  if (read.ok) discovery = read.value as Discovery;
  else {
    rethrowKitError(read.error);
    if (read.error instanceof ApiError && read.error.status === 401) redirect(303, "/login");
    /* stays null → empty state */
  }
  const sessionComplete = discovery?.session?.status === "COMPLETED";
  // Finished: the session was completed, or the project has moved on to the
  // requirements and beyond. The page then shows a read-only summary.
  const finished = sessionComplete || PAST_DISCOVERY.has(project.lifecycleStatus);
  // The page may request a batch by itself (a paid AI call) ONLY while discovery
  // is actually under way. Revisiting a finished discovery — e.g. from the
  // journey rail's "Discovery — done" link — must never start a generation.
  const mayAutoRequest = !finished && DISCOVERY_IN_PROGRESS.has(project.lifecycleStatus) && !!discovery?.session;
  return { project, discovery, finished, mayAutoRequest };
};

export const actions: Actions = {
  /** Request the next batch of discovery questions. */
  next: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      const result = await api<{
        questions: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
        readiness: string;
        source: string;
        complete: boolean;
      }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/discovery/next`, {});
      return {
        batch: result.questions.map((q) => ({ id: q.id, text: q.questionText, reason: q.reason, topic: q.topic, options: q.options ?? [], blocking: q.blocking })),
        readiness: result.readiness,
        complete: result.complete,
        source: result.source,
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not generate questions." });
    }
  },

  /** Start a session when none exists. */
  start: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/discovery-sessions`, { body: {} });
      return { started: true };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not start discovery." });
    }
  },

  /**
   * Submit every answered card of the current batch at once, then let the AI
   * immediately prepare the next batch (active loop). Empty cards are skipped.
   */
  answerBatch: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const qids = form.getAll("qid").map(String);
    // A suggestion chip answers in one tap: its value replaces whatever was typed.
    const choice = String(form.get("choice") ?? "").trim();
    const answers = choice ? [choice] : form.getAll("answer").map(String);
    // Question ids come from hidden inputs: never let one reshape the API path.
    if (qids.some((q) => q && !isUuid(q))) return fail(400, { message: BAD_ID });
    let submitted = 0;
    for (let i = 0; i < qids.length; i++) {
      const text = (answers[i] ?? "").trim();
      if (!qids[i] || !text) continue;
      try {
        await api(fetch, session, "POST", `/api/v1/discovery/questions/${qids[i]}/answer`, {
          body: { answer: text },
        });
        submitted += 1;
      } catch (error) {
        rethrowKitError(error);
        if (error instanceof ApiError) return fail(error.status, { message: error.message });
        return fail(500, { message: "Could not record an answer." });
      }
    }
    if (submitted === 0) return fail(422, { message: "Answer the question before submitting." });

    // AI moves actively: right after the batch, the engine prepares the next
    // batch (or reports completion with the readiness gate).
    try {
      const result = await api<{
        questions: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
        readiness: string;
        source: string;
        complete: boolean;
      }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/discovery/next`, {});
      return {
        submitted,
        // The last answer, so the page can offer to change it right away.
        last: { qid: qids[qids.length - 1]!, text: (answers[answers.length - 1] ?? "").trim() },
        batch: result.questions.map((q) => ({ id: q.id, text: q.questionText, reason: q.reason, topic: q.topic, options: q.options ?? [], blocking: q.blocking })),
        readiness: result.readiness,
        complete: result.complete,
        source: result.source,
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Your answer was saved, but loading the next question failed — reload the page." });
    }
  },

  /**
   * Change an answer already given. The API replaces the answer and the
   * user-stated fact it produced; nothing is asked of the engine, so this
   * never starts an AI call.
   */
  revise: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const questionId = formUuid(form, "qid");
    const answer = String(form.get("answer") ?? "").trim();
    if (!questionId) return fail(400, { message: BAD_ID });
    if (!answer) return fail(422, { message: "An answer can't be empty — write something or keep the old one." });
    try {
      await api(fetch, session, "POST", `/api/v1/discovery/questions/${questionId}/answer`, { body: { answer } });
      return { revised: questionId, notice: "Answer changed. The brief and its fact are updated." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not change that answer." });
    }
  },

  /**
   * Defer the current question ("I don't know — recommend" / "Skip / use
   * assumption"). The question becomes SKIPPED, the topic stays explicitly
   * uncovered, and the open point is recorded as a PROPOSED assumption for the
   * readiness gate (docs/14 §5).
   */
  defer: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const rawQuestionId = String(form.get("qid") ?? "");
    const recommendation = String(form.get("recommendation") ?? "").trim();
    if (!rawQuestionId) return fail(422, { message: "No question to defer." });
    const questionId = isUuid(rawQuestionId) ? rawQuestionId : null;
    if (!questionId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/discovery/questions/${questionId}/defer`, {
        body: { recommendation: recommendation || null },
      });
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not defer that question." });
    }
    // Advance to the next question, same as answering.
    try {
      const result = await api<{
        questions: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
        readiness: string;
        source: string;
        complete: boolean;
      }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/discovery/next`, {});
      return {
        deferred: true,
        notice: recommendation ? "Recorded as an assumption using the recommended default." : "Skipped and recorded as an open assumption.",
        batch: result.questions.map((q) => ({ id: q.id, text: q.questionText, reason: q.reason, topic: q.topic, options: q.options ?? [], blocking: q.blocking })),
        readiness: result.readiness,
        complete: result.complete,
        source: result.source,
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Question deferred, but loading the next one failed — reload the page." });
    }
  },

  /** Ask for 5 more deep-dive questions even when readiness is satisfied. */
  deepen: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      const result = await api<{
        questions: Array<{ id: string; questionText: string; reason: string; topic: string; options: string[]; blocking: boolean }>;
        readiness: string;
        source: string;
        complete: boolean;
      }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/discovery/next?deepen=true`, {});
      return {
        deepened: true,
        batch: result.questions.map((q) => ({ id: q.id, text: q.questionText, reason: q.reason, topic: q.topic, options: q.options ?? [], blocking: q.blocking })),
        readiness: result.readiness,
        complete: result.complete,
        source: result.source,
      };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not generate deep-dive questions." });
    }
  },

  acceptAssumptions: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const sessionId = formUuid(form, "sessionId");
    if (!sessionId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/discovery/sessions/${sessionId}/accept-assumptions`, { body: {} });
      return { accepted: true, notice: "Assumptions accepted — you can continue to the requirements." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not accept assumptions." });
    }
  },

  complete: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    // Proceeding on assumptions is only ever the user's explicit choice (C7):
    // the "proceed with assumptions" button sends this flag, nothing else does.
    const acceptAssumptions = form.get("accept_assumptions") === "1";
    try {
      const discovery = await api<{ session: { id: string } | null }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/discovery`);
      if (!discovery.session) return fail(409, { message: "Start discovery first." });
      await api(fetch, session, "POST", `/api/v1/discovery/sessions/${discovery.session.id}/complete`, {
        body: { accept_assumptions: acceptAssumptions },
      });
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not complete discovery." });
    }
    // Documented order is Discovery → Requirements → Stack (C7, docs/04 §2):
    // requirements must be the next step, not technology.
    redirect(303, `/projects/${params.projectId}/docs?tab=requirements&from=discovery`);
  },
};
