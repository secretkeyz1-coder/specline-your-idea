
/** Parsing a task contract's verification command into argv — never a shell — and refusing inline code and fetched packages. */

/**
 * Executables a task contract may name as a verification command (docs/13 §8:
 * the server never gets to run arbitrary shell text). Override with a
 * comma-separated SDD_AGENT_ALLOWED_COMMANDS.
 *
 * NOT a security boundary: `npm test` runs whatever package.json says, and the
 * repository's own code runs under every test runner. The allowlist and the
 * checks below only stop a task contract from smuggling INLINE code
 * (`node -e …`) or fetching an arbitrary package (`npx some-tool`) past a
 * reviewer who reads the contract. The trust boundary is the repository plus
 * the human who approved the plan.
 */
const ALLOWED_VERIFY_EXECUTABLES = new Set(
  (process.env.SDD_AGENT_ALLOWED_COMMANDS ??
    "bun,bunx,npm,npx,pnpm,yarn,node,deno,tsc,vitest,jest,eslint,python,python3,pytest,uv,go,cargo,make,dotnet,mvn,gradle,./gradlew,php,composer,ruby,bundle,rake,mix,swift")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);

/** Packages `npx`/`bunx`/`pnpm dlx`/`yarn dlx`/`npm exec` may run. Override with SDD_AGENT_ALLOWED_PACKAGES. */
const ALLOWED_RUNNER_PACKAGES = new Set(
  (process.env.SDD_AGENT_ALLOWED_PACKAGES ??
    "tsc,typescript,vitest,jest,eslint,prettier,@biomejs/biome,biome,playwright,@playwright/test,svelte-check,vue-tsc,mocha,ava,c8,nyc,cypress,stylelint,markdownlint-cli,turbo,nx")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);

/**
 * How each interpreter takes code on the command line. Short flags may be
 * clustered (`node -pe`, `python3 -Ic`), so a cluster is read letter by letter
 * until a letter that takes a value (`-Wignore`, `-mpytest`).
 */
interface InlineRule {
  /** Short-flag letters that run inline code. */
  short: string;
  /** Short-flag letters that take a value (the rest of the cluster or the next argument). */
  valued: string;
  /** Short-flag letters after whose value the interpreter stops reading its own options. */
  terminal?: string;
  long: readonly string[];
  subcommands?: readonly string[];
}

const NODE_RULE: InlineRule = { short: "ep", valued: "rC", long: ["--eval", "--print"] };
const PYTHON_RULE: InlineRule = { short: "c", valued: "WXm", terminal: "m", long: [] };

/** The interpreter an argv token names (`/usr/bin/python3.12`, `node.exe` → its rule), if any. */
function inlineRuleFor(token: string): InlineRule | null {
  const name = (token.split(/[\\/]/).pop() ?? token).toLowerCase().replace(/\.exe$/, "");
  if (name === "node" || name === "nodejs" || name === "bun") return NODE_RULE;
  if (/^python(\d+(\.\d+)*)?$/.test(name) || name === "pypy" || name === "pypy3") return PYTHON_RULE;
  switch (name) {
    case "deno":
      return { short: "", valued: "", long: ["--eval", "--eval-file"], subcommands: ["eval"] };
    case "ruby":
      return { short: "e", valued: "rIEC", long: [] };
    case "perl":
      return { short: "eE", valued: "IMmdx", long: [] };
    case "php":
      return { short: "rBRE", valued: "dcfzt", long: [] };
    case "rake":
      return { short: "epE", valued: "fCrIRgj", long: ["--execute", "--execute-print", "--execute-continue"] };
    case "mix":
      return { short: "e", valued: "", long: ["--eval"], subcommands: ["eval"] };
    default:
      return null;
  }
}

/** The first argument of `args` (what follows an interpreter) that runs inline code, if any. */
function inlineCodeArg(rule: InlineRule, args: string[]): string | null {
  // A value that follows a long option without "=" may or may not be that
  // option's value; keep reading options past it rather than miss a flag.
  let afterLongOption = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") return null;
    if (i === 0 && rule.subcommands?.includes(arg)) return arg;
    if (arg.startsWith("--")) {
      if (rule.long.some((f) => arg === f || arg.startsWith(`${f}=`))) return arg;
      afterLongOption = !arg.includes("=");
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      afterLongOption = false;
      const letters = arg.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const ch = letters[j]!;
        if (rule.short.includes(ch)) return arg;
        if (rule.valued.includes(ch)) {
          // `-m pytest`: the value is the next argument.
          if (j === letters.length - 1) i++;
          if (rule.terminal?.includes(ch)) return null;
          break;
        }
      }
      continue;
    }
    // The script or file to run: everything after it belongs to that program.
    if (!afterLongOption) return null;
    afterLongOption = false;
  }
  return null;
}

/** Executables that run another command given after them (`uv run python …`). */
const WRAPPER_EXECUTABLES = new Set(["uv", "bundle", "pnpm", "yarn", "npm", "npx", "bun", "bunx", "composer", "poetry", "pipenv"]);

/** Package name of an `npx`-style spec: "eslint@9" → "eslint", "@scope/pkg@1" → "@scope/pkg". */
function packageName(spec: string): string {
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/** The package an npx-style invocation would run, or a refusal reason. */
function runnerPackage(argv: string[]): { pkg: string | null } | { reason: string } {
  const [exe, sub] = argv;
  // Which argv index holds the package spec for each runner form.
  let start: number;
  if (exe === "npx" || exe === "bunx") start = 1;
  else if (exe === "bun" && sub === "x") start = 2;
  else if ((exe === "pnpm" || exe === "yarn") && sub === "dlx") start = 2;
  else if (exe === "npm" && (sub === "exec" || sub === "x")) start = 2;
  else return { pkg: null };
  for (let i = start; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-p" || arg === "--package" || arg.startsWith("--package=") || arg === "-c" || arg === "--call") {
      return { reason: `'${exe}' with ${arg} is not allowed in a verification command` };
    }
    if (arg.startsWith("-")) continue;
    return { pkg: packageName(arg) };
  }
  return { reason: `'${exe}' without a package to run` };
}

/** Split a command line into argv without a shell. Supports simple quoting;
 * rejects shell metacharacters so a contract cannot chain or redirect. */
export function parseVerificationCommand(command: string): { ok: true; argv: string[] } | { ok: false; reason: string } {
  if (/[;&|<>`$\n\r]/.test(command)) return { ok: false, reason: "shell metacharacters are not allowed" };
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || current) argv.push(current);
      current = "";
      has = false;
      continue;
    }
    current += ch;
    has = true;
  }
  if (quote) return { ok: false, reason: "unterminated quote" };
  if (has || current) argv.push(current);
  if (argv.length === 0) return { ok: false, reason: "empty command" };
  const exe = argv[0]!;
  if (!ALLOWED_VERIFY_EXECUTABLES.has(exe)) {
    return { ok: false, reason: `executable '${exe}' is not in the verification allowlist (SDD_AGENT_ALLOWED_COMMANDS)` };
  }
  // The interpreter itself, or one a wrapper runs (`uv run python -c …`,
  // `bundle exec ruby -e …`, `yarn node -e …`).
  const wrapped = WRAPPER_EXECUTABLES.has(exe);
  for (let i = 0; i < argv.length; i++) {
    if (i > 0 && !wrapped) break;
    const rule = inlineRuleFor(argv[i]!);
    if (!rule) continue;
    const flag = inlineCodeArg(rule, argv.slice(i + 1));
    if (flag) return { ok: false, reason: `'${argv[i]} ${flag}' runs inline code; verification must run a file or a test runner` };
  }
  // Code fetched by URL or registry specifier (`deno run npm:x`, `uv run https://…/x.py`).
  const remote = exe === "deno" ? /^(https?|npm|jsr):/i : /^https?:\/\//i;
  if ((exe === "deno" || wrapped) && argv.slice(1).some((arg) => remote.test(arg))) {
    return { ok: false, reason: "remote code is not allowed in a verification command" };
  }
  if (exe === "uv") {
    // `uv tool run`/`uv pip install` and `uv run --with <pkg>` fetch packages the contract names.
    if (argv[1] === "tool" || argv[1] === "pip") return { ok: false, reason: `'uv ${argv[1]}' is not allowed in a verification command` };
    const fetches = argv.find((arg) => /^--with(-requirements|-editable)?(=|$)/.test(arg));
    if (fetches) return { ok: false, reason: `'uv ${fetches}' installs extra packages; list them in the project instead` };
  }
  const runner = runnerPackage(argv);
  if ("reason" in runner) return { ok: false, reason: runner.reason };
  if (runner.pkg && !ALLOWED_RUNNER_PACKAGES.has(runner.pkg)) {
    return { ok: false, reason: `package '${runner.pkg}' is not in the runner allowlist (SDD_AGENT_ALLOWED_PACKAGES)` };
  }
  return { ok: true, argv };
}
