import { expect, test } from "bun:test";
import { Command } from "commander";
import { program } from "../src/commands/program.js";

const groups = ["auth", "project", "task", "ui", "run", "mcp", "bug", "update"] as const;

test("command modules do not mutate the shared program on import", async () => {
  expect(program.commands).toHaveLength(0);
  for (const group of groups) await import(`../src/commands/${group}.js`);
  expect(program.commands).toHaveLength(0);
});

test("each group explicitly registers on independent command trees without global guards", async () => {
  const trees = [new Command(), new Command()];
  for (const group of groups) {
    const module = await import(`../src/commands/${group}.js`);
    const register = module[`register${group[0]!.toUpperCase()}${group.slice(1)}`];
    expect(typeof register).toBe("function");
    for (const tree of trees) register(tree);
  }
  for (const tree of trees) {
    const names = tree.commands.map(command => command.name());
    expect(names).toEqual(["login", "logout", "whoami", "status", "project", "connect", "task", "ui", "run", "mcp", "bug", "update"]);
    expect(new Set(names).size).toBe(names.length);
    expect(tree.commands.find(command => command.name() === "project")!.commands.map(command => command.name())).toEqual(["connect", "list", "link", "status", "unlink"]);
  }
});
