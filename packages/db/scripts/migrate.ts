/**
 * Apply pending migrations using Bun SQL (T010, C19).
 * Usage: bun run scripts/migrate.ts
 */
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { createDb } from "../src/index.js";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(url);
try {
  await migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });
  console.log("Migrations applied.");
} finally {
  await db.close();
}
