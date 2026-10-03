import { sql, type SQL } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

export type JsonbShape = "object" | "array" | "container";
export const JSONB_DECODE_LIMIT = 4;

/** Decode legacy top-level JSON strings only. Never traverse intentional nested strings.
 * Malformed/scalar/wrong-shape input is retained so domain schema validation still fails.
 */
export function decodeJsonb(value: unknown, shape: JsonbShape = "container"): unknown {
  const original = value;
  for (let depth = 0; depth < JSONB_DECODE_LIMIT && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return original; }
  }
  if (value === null || typeof value !== "object") return original;
  if (shape === "array" && !Array.isArray(value)) return original;
  if (shape === "object" && Array.isArray(value)) return original;
  return value;
}

/** BunSQL otherwise binds Drizzle's serialized JSON as a JSON string. Force a text
 * parameter before PostgreSQL parses JSON. null means SQL NULL, not JSON "null".
 */
export function jsonbValue(value: unknown): SQL {
  if (value === null) return sql`NULL`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("JSONB value must be JSON serializable");
  return sql`cast(cast(${encoded} as text) as jsonb)`;
}

/** Schema-bound transport handles inserts, updates, upserts, returning and transactions. */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: jsonbValue,
  fromDriver: (value) => decodeJsonb(value),
});

export const jsonbObject = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb", toDriver: jsonbValue, fromDriver: value => decodeJsonb(value, "object"),
});
export const jsonbArray = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb", toDriver: jsonbValue, fromDriver: value => decodeJsonb(value, "array"),
});
