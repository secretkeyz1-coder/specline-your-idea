import { loadConfig, describeConfig } from "@sdd/config";
import { createDb, type SddDatabase } from "@sdd/db";
import { SecretBox, createLogger, type Logger } from "@sdd/shared";
import type { CliPolicy, GatewayDeps } from "@sdd/ai";

/**
 * Where LOCAL_CLI connections may run: on this server when the operator
 * turned it on, and on any connected machine through its sdd-agent.
 * (The gateway module is loaded lazily: it imports this file's types.)
 */
function cliPolicy(serverEnabled: boolean): CliPolicy {
  return {
    serverEnabled,
    runOnMachine: async (machineId, job) => (await import("./modules/agent/gateway.js")).runAiOnMachine(machineId, job),
  };
}

/** Process-wide singletons. Execution state never lives in memory alone (C5). */

export interface Infra {
  config: ReturnType<typeof loadConfig>;
  db: SddDatabase;
  secretBox: SecretBox;
  logger: Logger;
  /** AI gateway deps view (docs/06 §6). */
  gateway: () => GatewayDeps;
}

let infra: Infra | null = null;

export function initInfra(): Infra {
  if (infra) return infra;
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, base: { service: "sdd-api", env: config.NODE_ENV } });
  const db = createDb(config.DATABASE_URL);
  const secretBox = SecretBox.fromMasterKey(config.masterKey);
  logger.info("api infra ready", describeConfig(config));
  infra = {
    config,
    db,
    secretBox,
    logger,
    gateway: () => ({
      db,
      secretBox,
      allowPrivateEgress: config.ALLOW_PRIVATE_AI_EGRESS,
      maxResponseBytes: config.AI_MAX_RESPONSE_BYTES,
      logger,
      cli: cliPolicy(config.SDD_ENABLE_LOCAL_CLI),
    }),
  };
  return infra;
}

export function getInfra(): Infra {
  if (!infra) throw new Error("Infra not initialized");
  return infra;
}

/** Test hook: replace singletons and close the previous db pool. */
export async function setInfraForTests(next: Partial<Infra>): Promise<Infra> {
  const current = infra ?? initInfra();
  if (next.db && next.db !== current.db) await current.db.close().catch(() => undefined);
  infra = { ...current, ...next };
  return infra;
}
