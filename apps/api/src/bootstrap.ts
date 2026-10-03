import { countUsers, createUser, createWorkspaceWithOwner } from "@sdd/auth";
import { initInfra } from "./infra.js";
import { loadConfig } from "@sdd/config";

/**
 * First admin/bootstrap flow (T211): create the operator account + workspace
 * on a clean install. Also available via POST /api/v1/auth/bootstrap.
 * Usage: bun run bootstrap -- --email you@example.com --password 'S3cret!' --workspace "My Workspace"
 * Falls back to BOOTSTRAP_ADMIN_* env values when flags are omitted.
 */
const infra = initInfra();
const config = loadConfig();

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const email = (arg("email") ?? config.BOOTSTRAP_ADMIN_EMAIL)?.trim().toLowerCase();
const password = arg("password") ?? config.BOOTSTRAP_ADMIN_PASSWORD;
const workspace = arg("workspace") ?? config.BOOTSTRAP_WORKSPACE;

if (!email || !password) {
  console.error("Usage: bun run bootstrap -- --email <email> --password <password> [--workspace <name>]");
  console.error("Or set BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD in the environment.");
  process.exit(1);
}

if ((await countUsers(infra.db)) > 0) {
  console.log("An operator account already exists — nothing to do.");
  await infra.db.close();
  process.exit(0);
}

const user = await createUser(infra.db, { email, displayName: email.split("@")[0]!, password, isOperator: true });
await createWorkspaceWithOwner(infra.db, { name: workspace, ownerUserId: user.id });
console.log(`Bootstrap complete: operator ${email} created with workspace "${workspace}".`);
await infra.db.close();
