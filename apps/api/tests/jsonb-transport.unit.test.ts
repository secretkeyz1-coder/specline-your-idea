import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { getTableColumns } from "drizzle-orm";
import { decodeJsonb, jsonbValue } from "@sdd/db";
import { schema } from "@sdd/db";
import { jsonbObject, jsonbArray } from "../../../packages/db/src/jsonb.js";
import { normalizeDescription } from "../src/modules/discovery/dedupe.js";
import { computeReadiness, discoveryAllowsRequirements } from "../src/modules/discovery/readiness.js";

const dialect = new PgDialect();
const query = (value: unknown) => dialect.sqlToQuery(jsonbValue(value));

describe("JSONB bounded read normalization", () => {
  const object = { answer: '{"intentional":"string"}', nested: { text: '[1,2]' }, list: ['{"x":1}'] };
  test("objects, arrays and nested intentional strings retain identity/content", () => {
    expect(decodeJsonb(object)).toBe(object);
    expect(decodeJsonb(JSON.stringify(object))).toEqual(object);
    expect(decodeJsonb(JSON.stringify(JSON.stringify(object)))).toEqual(object);
    expect(decodeJsonb('["{\\"x\\":1}"]', "array")).toEqual(['{"x":1}']);
  });
  test("malformed, scalar, wrong shape, null and over-depth strings stay invalid", () => {
    for (const value of ['{invalid}', '"hello"', '42', 'true', 'null', null]) expect(decodeJsonb(value)).toBe(value);
    expect(decodeJsonb('[]', "object")).toBe('[]');
    expect(decodeJsonb('{}', "array")).toBe('{}');
    let encoded: unknown = object;
    for (let i = 0; i < 5; i++) encoded = JSON.stringify(encoded);
    expect(decodeJsonb(encoded)).toBe(encoded);
  });
});

test("text parameter cast prevents BunSQL double JSON encoding; null is SQL NULL", () => {
  for (const value of [{ text: '"quotes"', nested: '[1]' }, [], ['one', 'two']]) {
    expect(query(value).sql).toBe('cast(cast($1 as text) as jsonb)');
    expect(query(value).params).toEqual([JSON.stringify(value)]);
  }
  expect(query(null)).toMatchObject({ sql: 'NULL', params: [] });
  expect(() => query(undefined)).toThrow();
});

test("Drizzle insert/update/upsert query compilation expands the shared SQL mapper", async () => {
  // Constructing the pool does not connect; toSQL exercises the real BunSQL dialect.
  const client = new SQL("postgres://fixture:fixture@127.0.0.1:1/disposable_test");
  const db = drizzle({ client });
  const table = pgTable("fixture", { id: text("id").primaryKey(), object: jsonbObject("object"), array: jsonbArray("array") });
  try {
    const insert = db.insert(table).values({ id: "a", object: { x: 1 }, array: ["x"] }).onConflictDoUpdate({ target: table.id, set: { object: { x: 2 } } }).returning().toSQL();
    expect(insert.sql.match(/cast\(cast\(\$\d+ as text\) as jsonb\)/g)).toHaveLength(3);
    expect(insert.params).toEqual(["a", '{"x":1}', '["x"]', '{"x":2}']);
    const update = db.update(table).set({ object: { changed: true }, array: null }).toSQL();
    expect(update.sql).toContain('cast(cast($1 as text) as jsonb)');
    expect(update.params).toEqual(['{"changed":true}', null]);
  } finally { await client.close(); }
});

test("every schema JSONB column uses the shared driver mapper", () => {
  let count = 0;
  for (const table of Object.values(schema)) {
    if (!(table as any)[Symbol.for("drizzle:IsDrizzleTable")]) continue;
    for (const column of Object.values(getTableColumns(table as any))) {
      if (column.getSQLType() !== "jsonb") continue;
      count++;
      const mapped = column.mapToDriverValue({ fixture: true });
      expect(dialect.sqlToQuery(mapped as any).sql).toBe('cast(cast($1 as text) as jsonb)');
    }
  }
  expect(count).toBeGreaterThanOrEqual(30);
  expect(schema.discoverySessions.coverage.mapFromDriverValue('{"problem":{"status":"KNOWN","blocking":false}}')).toEqual({ problem: { status: "KNOWN", blocking: false } });
  expect(schema.discoveryQuestions.options.mapFromDriverValue('["a"]')).toEqual(['a']);
  expect(schema.discoveryQuestions.options.mapFromDriverValue('{}')).toBe('{}');
});

test("exact description dedupe normalizes whitespace but not case or paraphrases", () => {
  expect(normalizeDescription('  Use\n Redis   cache ')).toBe('Use Redis cache');
  expect(normalizeDescription('Use Redis cache')).not.toBe(normalizeDescription('Use redis cache'));
  expect(normalizeDescription('Use Redis cache')).not.toBe(normalizeDescription('Use memory cache'));
});

test("accepted assumptions and capped answers cannot waive live required/blocking gaps", () => {
  const session = { status: "ACTIVE", coverage: {} } as any;
  const assumptions = [{ status: "ACCEPTED" }] as any;
  const answers = Array.from({ length: 15 }, () => ({ question: { blocking: false, status: "ANSWERED" }, answer: null })) as any;
  const readiness = computeReadiness(session, [], assumptions, answers);
  expect(readiness).toBe("INCOMPLETE");
  expect(discoveryAllowsRequirements(session, readiness)).toBe(false);
  expect(discoveryAllowsRequirements({ status: "COMPLETED" }, readiness)).toBe(true);
});

// Opt-in ONLY: no DATABASE_URL fallback; must name a disposable loopback DB.
// Roundtrip uses a temporary table. Migration fixtures replace public only INSIDE
// a rollback transaction and only in an explicitly named specline_jsonb_verify DB.
const disposableUrl = process.env.JSONB_DISPOSABLE_DATABASE_URL;
test.skipIf(!disposableUrl)("BunSQL raw jsonb_typeof/operators, insert/update/transaction roundtrip", async () => {
  const url = new URL(disposableUrl!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/disposable|test|^\/specline_jsonb_verify_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Explicit disposable loopback test database required");
  const client = new SQL(disposableUrl!);
  const table = pgTable("jsonb_transport_fixture", { id: text("id").primaryKey(), object: jsonbObject("object"), array: jsonbArray("array"), nullable: jsonbObject("nullable") });
  const db = drizzle({ client });
  try {
    await db.transaction(async tx => {
      await tx.execute((await import("drizzle-orm")).sql`CREATE TEMP TABLE jsonb_transport_fixture (id text primary key, object jsonb, "array" jsonb, nullable jsonb) ON COMMIT DROP`);
      const payload = { answer: '{"nested":"intentional"}', values: [1, 2] };
      const [inserted] = await tx.insert(table).values({ id: "a", object: payload, array: ["x"], nullable: null }).returning();
      expect(inserted!.object).toEqual(payload);
      expect(inserted!.array).toEqual(["x"]);
      expect(inserted!.nullable).toBeNull();
      const { sql, eq } = await import("drizzle-orm");
      const raw = await tx.execute(sql`SELECT jsonb_typeof(object) AS object_type, jsonb_typeof("array") AS array_type, object->>'answer' AS answer, "array" @> '["x"]'::jsonb AS contains, nullable IS NULL AS is_null FROM jsonb_transport_fixture`);
      expect(raw[0]).toMatchObject({ object_type: "object", array_type: "array", answer: payload.answer, contains: true, is_null: true });
      await tx.update(table).set({ array: ["y"], object: { updated: true } }).where(eq(table.id, "a"));
      expect((await tx.select().from(table))[0]).toMatchObject({ object: { updated: true }, array: ["y"] });
      await tx.execute(sql`UPDATE jsonb_transport_fixture SET object = to_jsonb(${JSON.stringify(payload)}::text)`);
      expect((await tx.select().from(table))[0]!.object).toEqual(payload);
    });
  } finally { await client.close(); }
});


test.skipIf(!disposableUrl)("backfill whitelist, malformed isolation, shape checks, checksum preservation and idempotence", async () => {
  const url = new URL(disposableUrl!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^\/specline_jsonb_verify_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Migration requires an explicitly named specline_jsonb_verify database");
  const migration = readFileSync(new URL("../../../packages/db/drizzle/0010_jsonb_transport.sql", import.meta.url), "utf8");
  const whitelist = [...migration.matchAll(/\('([a-z_]+)','([a-z_]+)','(object|array|container)'\)/g)].map(match => ({ table: match[1]!, column: match[2]!, shape: match[3]! }));
  expect(whitelist).toHaveLength(30);
  const client = new SQL(disposableUrl!);
  const rollback = new Error("fixture rollback");
  try {
    await expect(client.begin(async tx => {
      // Transactional DDL is rolled back even on an assertion failure.
      await tx.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      const tables = new Map<string, string[]>();
      for (const entry of whitelist) tables.set(entry.table, [...(tables.get(entry.table) ?? []), entry.column]);
      for (const [table, columns] of tables) {
        await tx.unsafe(`CREATE TABLE public.${table} (id integer primary key, checksum text, intentional_text text, ${columns.map(column => `${column} jsonb`).join(", ")})`);
        await tx.unsafe(`INSERT INTO public.${table} (id, checksum, intentional_text) SELECT id, 'unchanged-checksum', '{"intentional":"text"}' FROM generate_series(1,11) id`);
      }
      for (const { table, column, shape } of whitelist) {
        const valid = shape === "array" ? ['{"intentional":"string"}', { inner: '[1,2]' }] : { text: '{"intentional":"string"}', nested: ['[1,2]'] };
        let deep: unknown = valid;
        for (let i = 0; i < 5; i++) deep = JSON.stringify(deep);
        const values = [valid, JSON.stringify(valid), JSON.stringify(JSON.stringify(valid)), '{malformed}', shape === "array" ? '{}' : '[]', '42', null, deep, 'ordinary intentional string', String.raw`{"x":"\u0000"}`, '{"x":1e1000000}'];
        for (let id = 1; id <= values.length; id++) await tx.unsafe(`UPDATE public.${table} SET ${column} = $1::text::jsonb WHERE id = $2`, [JSON.stringify(values[id - 1]), id]);
      }
      const snapshot = async () => {
        const rows: unknown[] = [];
        for (const table of tables.keys()) rows.push(await tx.unsafe(`SELECT * FROM public.${table} ORDER BY id`));
        return JSON.stringify(rows);
      };
      const before = await snapshot();
      await tx.unsafe(migration);
      for (const { table, column, shape } of whitelist) {
        const rows = await tx.unsafe(`SELECT id, jsonb_typeof(${column}) AS shape, ${column} AS value, checksum, intentional_text FROM public.${table} ORDER BY id`);
        for (const row of rows) {
          expect(row.checksum).toBe("unchanged-checksum");
          expect(row.intentional_text).toBe('{"intentional":"text"}');
          if (row.id <= 3) expect(row.shape).toBe(shape === "array" ? "array" : "object");
          else if (row.id === 5 && shape === "container") expect(row.shape).toBe("array");
          else if (row.id === 7) expect(row.shape).toBe("null");
          else expect(row.shape).toBe("string");
        }
        expect(rows[0]!.value).toEqual(rows[1]!.value);
        expect(rows[0]!.value).toEqual(rows[2]!.value);
      }
      const after = await snapshot();
      expect(after).not.toBe(before);
      await tx.unsafe(migration);
      expect(await snapshot()).toBe(after);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await client.close(); }
});
