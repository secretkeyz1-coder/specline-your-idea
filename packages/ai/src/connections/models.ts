import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { DomainError, SecretBox } from "@sdd/shared";
import { guardedFetch, readCapped } from "../ssrf.js";
import { defaultAuthHeaders, modelsUrl, providerStaticHeaders } from "../endpoints.js";
import { buildAuthHeaders } from "../roles.js";
import { parseCliTarget } from "@sdd/agent-cli";
import type { ProviderGatewayConfig } from "./providers.js";

/** Model discovery for the settings page: the model list a connection (or an endpoint being added) offers. */

/* ── Model discovery (settings UX: pick a model instead of typing one) ── */

/** Normalised model list, regardless of provider response shape. */
export interface ProviderModelsResult {
  models: string[];
  error?: string;
}

function extractModelIds(providerType: string, payload: unknown): string[] {
  const ids: string[] = [];
  const data = (payload as { data?: unknown; models?: unknown }) ?? {};
  if (Array.isArray(data.data)) {
    // OpenAI shape: { data: [{ id: "gpt-4o" }, …] }
    for (const entry of data.data as Array<Record<string, unknown>>) {
      if (typeof entry?.id === "string") ids.push(entry.id);
    }
  } else if (Array.isArray(data.models)) {
    for (const entry of data.models as Array<Record<string, unknown>>) {
      // Gemini shape: { models: [{ name: "models/gemini-1.5-pro" }] }
      const raw = typeof entry?.name === "string" ? entry.name : typeof entry?.id === "string" ? entry.id : null;
      if (raw) ids.push(raw.replace(/^models\//, ""));
    }
  }
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

async function fetchModelList(
  url: string,
  headers: Record<string, string>,
  config: ProviderGatewayConfig,
  providerType: string,
): Promise<ProviderModelsResult> {
  // Same egress path as generation: DNS pinning (no rebinding), same-origin
  // redirects only, timeout covering the body, and a hard size cap. A plain
  // fetch() here was an SSRF primitive reachable from the settings dialog.
  let response: Response;
  let text: string;
  try {
    response = await guardedFetch(url, {
      method: "GET",
      headers: { ...headers, accept: "application/json" },
      timeoutMs: 15_000,
      maxBytes: config.maxResponseBytes,
      allowPrivateEgress: config.allowPrivateEgress,
    });
    text = await readCapped(response, config.maxResponseBytes);
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : "Request failed" };
  }
  if (!response.ok) {
    // Status only: echoing the body would turn this into a read primitive.
    return { models: [], error: `Provider answered HTTP ${response.status}` };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { models: [], error: "Response was not JSON" };
  }
  return { models: extractModelIds(providerType, payload) };
}

/** List models for a SAVED connection (credential decrypted server-side). */
export async function listProviderModels(
  db: DbExecutor,
  secretBox: SecretBox,
  config: ProviderGatewayConfig,
  connectionId: string,
): Promise<ProviderModelsResult> {
  const [row] = await db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).limit(1);
  if (!row) throw new DomainError("PROVIDER_NOT_FOUND", "Provider connection not found", 404);
  if (row.providerType === "LOCAL_CLI") {
    // A CLI takes model aliases; "default" keeps the CLI's own choice.
    const target = parseCliTarget(row.baseUrl);
    return { models: ["default", ...(target?.tool === "claude" ? ["sonnet", "opus", "haiku"] : [])] };
  }
  const headers = await buildAuthHeaders(secretBox, row);
  const url = modelsUrl(row.providerType, row.baseUrl);
  if (!url) return { models: [], error: "Connection has no base URL" };
  return fetchModelList(url, { ...providerStaticHeaders(row.providerType), ...headers }, config, row.providerType);
}

/** List models for UNSAVED form data (the Add-Connection dialog, before save). */
export async function previewProviderModels(
  secretBox: SecretBox,
  config: ProviderGatewayConfig,
  input: { provider_type: string; base_url: string; credential?: string },
): Promise<ProviderModelsResult> {
  const url = modelsUrl(input.provider_type, input.base_url);
  if (!url) return { models: [], error: "A base URL is required for this provider" };
  const headers: Record<string, string> = {
    ...providerStaticHeaders(input.provider_type),
    ...(input.credential ? defaultAuthHeaders(input.provider_type, input.credential) : {}),
  };
  return fetchModelList(url, headers, config, input.provider_type);
}
