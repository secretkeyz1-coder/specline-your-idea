/** Decrypt the stored connection credential and probe the upstream directly.
 * Usage: bun scripts/probe-connection.ts <connectionId> <model> */
import { initInfra } from "../src/infra.js";
import { buildAuthHeaders } from "@sdd/ai";
import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";

const infra = initInfra();
const connectionId = process.argv[2]!;
const model = process.argv[3] ?? "gpt-4o-mini";

const [row] = await infra.db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).limit(1);
if (!row) {
  console.error("connection not found");
  process.exit(1);
}
const headers = await buildAuthHeaders(infra.secretBox, row);
console.log("endpoint:", `${row.baseUrl}/chat/completions`);
console.log("auth header present:", Object.keys(headers).join(", "));

const response = await fetch(`${row.baseUrl}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 5 }),
});
const text = await response.text();
console.log("HTTP", response.status, "->", text.slice(0, 300));
await infra.db.close();
