import { expect, test, spyOn } from "bun:test";
import { createUserCode } from "../src/tokens.js";
import { createWorkspaceWithOwner } from "../src/service.js";
import type { DbExecutor } from "@sdd/db";

test("workspace slug normalization preserves trim-before-truncate without a database", async () => {
  for (const [name, slug] of [
    ["  Hello World!  ", "hello-world"],
    ["!".repeat(8192), "workspace"],
    [`${"!".repeat(8192)}Hello${"!".repeat(8192)}`, "hello"],
    [`${"a".repeat(39)} b`, `${"a".repeat(39)}-`],
  ]) {
    let inserted: Record<string, unknown> = {};
    const tx = { insert() { return { values(value: Record<string, unknown>) {
      if ("slug" in value) inserted = value;
      return { onConflictDoNothing() { return { returning: async () => [{ id: "workspace", ...inserted }] }; } };
    } }; } };
    const db = { transaction: async (fn: (executor: unknown) => unknown) => fn(tx) } as unknown as DbExecutor;
    await createWorkspaceWithOwner(db, { name: name!, ownerUserId: "owner" });
    expect(inserted.slug).toBe(slug);
  }
});

test("device user codes reject the incomplete random-byte range and keep the public format", () => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const limit = 256 - (256 % alphabet.length);
  let calls = 0;
  const random = spyOn(crypto, "getRandomValues").mockImplementation((array: any) => {
    const samples = calls++ === 0 ? [limit, 255, 0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11, 12, 13];
    array.set(samples);
    return array;
  });
  try {
    expect(createUserCode()).toBe(`${alphabet.slice(0, 4)}-${alphabet.slice(4, 8)}`);
    expect(calls).toBe(2);
  } finally { random.mockRestore(); }
  expect(createUserCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
});
