import type { CliBundle } from "./bundle.js";

/**
 * The one-line installers a coding agent runs on its own when `sddctl` is
 * missing (see the execution prompt's Phase 1):
 *
 *   curl -fsSL <server>/api/v1/cli/install.sh | sh
 *   irm <server>/api/v1/cli/install.ps1 | iex
 *
 * Each needs Node.js 18+ or Bun, downloads the bundle from the same server,
 * checks it against the checksum written into the script, and installs it in
 * ~/.sdd/bin (SDD_HOME overrides ~/.sdd). Agent shells often keep no state
 * between commands, so the installer also puts the shim on PATH where it can
 * and always prints the full path to fall back on.
 */

export const CLI_BASE_PATH = "/api/v1/cli";

/** A URL safe inside single quotes in both sh and PowerShell (the server URL is validated, this is belt and braces). */
const quoted = (s: string) => `'${s.replace(/'/g, "%27")}'`;

export function installCommands(server: string): { sh: string; ps1: string } {
  const base = `${server.replace(/\/+$/, "")}${CLI_BASE_PATH}`;
  return { sh: `curl -fsSL ${base}/install.sh | sh`, ps1: `irm ${base}/install.ps1 | iex` };
}

export function installSh(server: string, bundle: Pick<CliBundle, "version" | "sha256">): string {
  const base = server.replace(/\/+$/, "");
  return [
    "#!/bin/sh",
    `# sddctl ${bundle.version} installer, served by the SDD control plane at ${base}.`,
    "# Installs into ~/.sdd/bin (SDD_HOME overrides ~/.sdd). Needs Node.js 18+ or Bun.",
    "set -eu",
    `SERVER=${quoted(base)}`,
    `SHA256=${quoted(bundle.sha256)}`,
    `VERSION=${quoted(bundle.version)}`,
    'DIR="${SDD_HOME:-$HOME/.sdd}/bin"',
    "",
    "if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(\".\")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then",
    "  RUNTIME=node",
    "elif command -v bun >/dev/null 2>&1; then",
    "  RUNTIME=bun",
    "else",
    '  echo "sddctl needs Node.js 18 or newer (https://nodejs.org) or Bun (https://bun.sh). Install one, then run this installer again." >&2',
    "  exit 1",
    "fi",
    "",
    'mkdir -p "$DIR"',
    'TMP="$DIR/sddctl.mjs.download"',
    "if command -v curl >/dev/null 2>&1; then",
    `  curl -fsSL "$SERVER${CLI_BASE_PATH}/sddctl.mjs" -o "$TMP"`,
    "else",
    `  wget -qO "$TMP" "$SERVER${CLI_BASE_PATH}/sddctl.mjs"`,
    "fi",
    // Hash from stdin: given a path with a backslash (Windows, Git Bash) sha256sum prefixes its line with a backslash.
    "if command -v sha256sum >/dev/null 2>&1; then",
    "  GOT=$(sha256sum < \"$TMP\" | cut -d' ' -f1)",
    "elif command -v shasum >/dev/null 2>&1; then",
    "  GOT=$(shasum -a 256 < \"$TMP\" | cut -d' ' -f1)",
    "else",
    '  GOT="$SHA256"',
    "fi",
    'if [ "$GOT" != "$SHA256" ]; then',
    '  rm -f "$TMP"',
    '  echo "The downloaded sddctl does not match its checksum; nothing was installed." >&2',
    "  exit 1",
    "fi",
    'mv "$TMP" "$DIR/sddctl.mjs"',
    "",
    'printf \'#!/bin/sh\\nexec %s "%s" "$@"\\n\' "$RUNTIME" "$DIR/sddctl.mjs" > "$DIR/sddctl"',
    'chmod +x "$DIR/sddctl"',
    "",
    "# On PATH already, or in a user bin directory that is: then `sddctl` works in every new command.",
    'ON_PATH=""',
    'case ":$PATH:" in *":$DIR:"*) ON_PATH="$DIR" ;; esac',
    'if [ -z "$ON_PATH" ]; then',
    '  for BIN in "$HOME/.local/bin" "$HOME/bin"; do',
    '    case ":$PATH:" in *":$BIN:"*)',
    // Never over another sddctl (a source checkout's `bun link`, a hand-made one): only over this installer's own shim.
    '      if [ -e "$BIN/sddctl" ] && ! grep -q "sddctl.mjs" "$BIN/sddctl" 2>/dev/null; then continue; fi',
    '      if [ -d "$BIN" ] && [ -w "$BIN" ]; then cp "$DIR/sddctl" "$BIN/sddctl" && chmod +x "$BIN/sddctl" && ON_PATH="$BIN" && break; fi ;;',
    "    esac",
    "  done",
    "fi",
    'echo "Installed sddctl $VERSION: $DIR/sddctl"',
    'if [ -n "$ON_PATH" ]; then',
    '  echo "sddctl is on PATH ($ON_PATH)."',
    "else",
    '  echo "sddctl is not on PATH. Call it as $DIR/sddctl, or add the folder: export PATH=\\"$DIR:\\$PATH\\""',
    "fi",
    "",
  ].join("\n");
}

export function installPs1(server: string, bundle: Pick<CliBundle, "version" | "sha256">): string {
  const base = server.replace(/\/+$/, "");
  return [
    `# sddctl ${bundle.version} installer, served by the SDD control plane at ${base}.`,
    "# Installs into ~\\.sdd\\bin (SDD_HOME overrides ~\\.sdd) and adds it to the user PATH (unless SDD_NO_PATH=1). Needs Node.js 18+ or Bun.",
    "$ErrorActionPreference = 'Stop'",
    `$Server = ${quoted(base)}`,
    `$Sha256 = ${quoted(bundle.sha256)}`,
    `$Version = ${quoted(bundle.version)}`,
    "$Root = if ($env:SDD_HOME) { $env:SDD_HOME } else { Join-Path $HOME '.sdd' }",
    "$Dir = Join-Path $Root 'bin'",
    "",
    "$Runtime = $null",
    "if (Get-Command node -ErrorAction SilentlyContinue) {",
    "  & node -e \"process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)\"",
    "  if ($LASTEXITCODE -eq 0) { $Runtime = 'node' }",
    "}",
    "if (-not $Runtime -and (Get-Command bun -ErrorAction SilentlyContinue)) { $Runtime = 'bun' }",
    "if (-not $Runtime) { throw 'sddctl needs Node.js 18 or newer (https://nodejs.org) or Bun (https://bun.sh). Install one, then run this installer again.' }",
    "",
    "New-Item -ItemType Directory -Force -Path $Dir | Out-Null",
    "$Tmp = Join-Path $Dir 'sddctl.mjs.download'",
    `Invoke-WebRequest -UseBasicParsing -Uri "$Server${CLI_BASE_PATH}/sddctl.mjs" -OutFile $Tmp`,
    "$Got = (Get-FileHash -Algorithm SHA256 -Path $Tmp).Hash.ToLower()",
    "if ($Got -ne $Sha256) { Remove-Item -Force $Tmp; throw 'The downloaded sddctl does not match its checksum; nothing was installed.' }",
    "Move-Item -Force $Tmp (Join-Path $Dir 'sddctl.mjs')",
    "",
    "# cmd and PowerShell run sddctl.cmd; Git Bash runs the extensionless shim.",
    "Set-Content -Encoding ASCII -Path (Join-Path $Dir 'sddctl.cmd') -Value ('@echo off' + [char]13 + [char]10 + $Runtime + ' \"%~dp0sddctl.mjs\" %*')",
    "Set-Content -Encoding ASCII -NoNewline -Path (Join-Path $Dir 'sddctl') -Value ('#!/bin/sh' + [char]10 + 'exec ' + $Runtime + ' \"$(dirname \"$0\")/sddctl.mjs\" \"$@\"' + [char]10)",
    "",
    "# SDD_NO_PATH=1 leaves the user PATH alone (CI, tests).",
    "if (-not $env:SDD_NO_PATH) {",
    "  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "  if (-not (($UserPath -split ';') -contains $Dir)) {",
    "    [Environment]::SetEnvironmentVariable('Path', ((@($UserPath, $Dir) | Where-Object { $_ }) -join ';'), 'User')",
    "  }",
    "}",
    "if (-not (($env:Path -split ';') -contains $Dir)) { $env:Path = $env:Path + ';' + $Dir }",
    'Write-Host "Installed sddctl ${Version}: $Dir\\sddctl.cmd"',
    'Write-Host "New terminals find sddctl on PATH. In a shell opened before this, call it as $Dir\\sddctl.cmd"',
    "",
  ].join("\r\n");
}
