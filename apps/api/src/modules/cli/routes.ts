import { Elysia } from "elysia";
import { errors } from "@sdd/shared";
import type { Infra } from "../../infra.js";
import { cliBundle } from "./bundle.js";
import { CLI_BASE_PATH, installCommands, installPs1, installSh } from "./installers.js";

/**
 * Public CLI downloads (no sign-in: nothing here is secret, and the agent that
 * needs them has not signed in yet). Under /api/v1 so the production proxy
 * already routes them to the API.
 */
export function cliRoutes(infra: Infra) {
  const server = infra.config.API_PUBLIC_URL;
  const bundleOrFail = async () => {
    const bundle = await cliBundle();
    if (!bundle) throw errors.notFound("sddctl bundle (this server was built without the CLI)");
    return bundle;
  };
  return new Elysia({ prefix: CLI_BASE_PATH })
    .get("/sddctl.mjs", async ({ set }) => {
      const bundle = await bundleOrFail();
      set.headers["content-type"] = "text/javascript; charset=utf-8";
      set.headers["content-disposition"] = 'attachment; filename="sddctl.mjs"';
      set.headers["x-sddctl-version"] = bundle.version;
      set.headers["x-sddctl-sha256"] = bundle.sha256;
      set.headers["cache-control"] = "no-cache";
      return bundle.code;
    })
    .get("/install.sh", async ({ set }) => {
      set.headers["content-type"] = "text/x-shellscript; charset=utf-8";
      set.headers["cache-control"] = "no-cache";
      return installSh(server, await bundleOrFail());
    })
    .get("/install.ps1", async ({ set }) => {
      set.headers["content-type"] = "text/plain; charset=utf-8";
      set.headers["cache-control"] = "no-cache";
      return installPs1(server, await bundleOrFail());
    })
    // What the web app shows next to a machine: the commands and the version they install.
    .get("/", async () => {
      const bundle = await cliBundle();
      return { available: Boolean(bundle), version: bundle?.version ?? null, install: installCommands(server) };
    });
}
