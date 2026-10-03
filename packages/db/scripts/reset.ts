/**
 * Dev convenience: drop the public schema and re-apply all migrations.
 * Never point this at a production database.
 */
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = new SQL(url);
await sql`DROP SCHEMA IF EXISTS public CASCADE`;
await sql`CREATE SCHEMA public`;
await sql`GRANT ALL ON SCHEMA public TO current_user`;
await sql.close();
console.log("public schema dropped. Run `bun run db:migrate` to re-apply.");
