import type { ProviderAdapter } from "./types.js";
import { openAiAdapter } from "./adapters/openai.js";
import { anthropicAdapter } from "./adapters/anthropic.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { customHttpAdapter } from "./adapters/customHttp.js";
import { cliAdapter } from "./adapters/cli.js";
import { DomainError } from "@sdd/shared";
import type { ProviderType } from "@sdd/contracts";

const ADAPTERS: ProviderAdapter[] = [openAiAdapter, anthropicAdapter, geminiAdapter, customHttpAdapter, cliAdapter];

export function adapterFor(providerType: ProviderType): ProviderAdapter {
  const adapter = ADAPTERS.find((a) => a.providerTypes.includes(providerType));
  if (!adapter) throw new DomainError("PROVIDER_UNSUPPORTED", `No adapter for provider type ${providerType}`, 400);
  return adapter;
}
