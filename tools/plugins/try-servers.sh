#!/usr/bin/env bash
# Starts the plugin's local MCP server from each harness this machine has, each in a scratch home,
# and checks that the server sends nothing (D148, D164 item 4; docs/agents/check-harness-plugins.md,
# step 3). On macOS, Linux and native Windows (in Git's bash).
#
#   tools/plugins/try-servers.sh <built plugin dir> <empty scratch dir>
#
# The plugin's launch is `npx -y @mostra/cli@<release> mcp --embedded`, so npm must find that
# version: `npm_config_registry` names the registry (a local one serving the branch's packed
# tarballs, as in CI's harness-plugins workflow). Telemetry is forced on toward a local collector,
# which must receive nothing. For each harness: Claude Code (`claude mcp list`), Gemini CLI
# (`gemini mcp list`), Codex (its app server's `mcpServerStatus/list`, which starts each server and
# lists its tools with no model) and Copilot CLI (`copilot mcp list`, which only lists: starting a
# server needs a signed-in session). Each runs with its home in the scratch directory. Exit 1 when
# any harness that ran failed.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$1" && pwd)"
scratch="$2"
mkdir -p "$scratch"
scratch="$(cd "$scratch" && pwd)"
export PATH="${MOSTRA_HARNESS_BIN:+$MOSTRA_HARNESS_BIN:}$PATH"
windows=false
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) windows=true ;; esac
# A path as the harnesses take it: a Windows path on Windows, else as it is.
native() { if $windows; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
limited() { perl -e 'alarm shift; exec @ARGV' "$@" </dev/null; }
failed=0
pass() { echo "✓ $1"; }
fail() { echo "✗ $1"; failed=1; }

# A collector that records every request it gets.
node -e '
  const http = require("node:http"); const fs = require("node:fs");
  const log = process.argv[1];
  fs.writeFileSync(log, "");
  const server = http.createServer((req, res) => { fs.appendFileSync(log, `${req.method} ${req.url}\n`); req.resume(); res.end("{}"); });
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(log + ".port", String(server.address().port)));
' "$(native "$scratch/collector.log")" &
collector=$!
trap 'kill $collector 2>/dev/null' EXIT
for _ in $(seq 1 50); do [ -s "$scratch/collector.log.port" ] && break; sleep 0.2; done
[ -s "$scratch/collector.log.port" ] || { echo "✗ the collector didn't start" >&2; exit 2; }

# What every server inherits when its harness passes the environment on.
export npm_config_registry="${npm_config_registry:-https://registry.npmjs.org/}"
export npm_config_cache npm_config_update_notifier=false
npm_config_cache="$(native "$scratch/npm-cache")"
export MOSTRA_HOME MOSTRA_CONFIG_DIR MOSTRA_MCP_WORKSPACE MOSTRA_TELEMETRY=1 MOSTRA_TELEMETRY_ENDPOINT
MOSTRA_HOME="$(native "$scratch/mostra-home")"
MOSTRA_CONFIG_DIR="$(native "$scratch/mostra-config")"
MOSTRA_MCP_WORKSPACE="$(native "$scratch/artifacts")"
MOSTRA_TELEMETRY_ENDPOINT="http://127.0.0.1:$(cat "$scratch/collector.log.port")/v1/events"
unset DO_NOT_TRACK MOSTRA_TELEMETRY_DEBUG

# A harness may start its servers with a cleaned environment (Codex does), so each gets a scratch
# home whose .npmrc names the registry and the cache; Mostra's defaults then land there too.
home_for() {
  mkdir -p "$1"
  node -e 'require("node:fs").writeFileSync(process.argv[1] + "/.npmrc", `registry=${process.argv[2]}\ncache=${process.argv[3]}\nupdate-notifier=false\n`)' \
    "$(native "$1")" "$npm_config_registry" "$npm_config_cache"
}
as_home() { local home="$1"; shift; HOME="$home" USERPROFILE="$(native "$home")" "$@"; }

if command -v claude >/dev/null; then
  home="$scratch/claude"; home_for "$home"
  export CLAUDE_CONFIG_DIR; CLAUDE_CONFIG_DIR="$(native "$home")"
  as_home "$home" limited 120 claude plugin marketplace add "$(native "$plugin")" >"$home/add.log" 2>&1
  as_home "$home" limited 120 claude plugin install mostra@mostra >"$home/install.log" 2>&1
  (cd "$scratch" && MCP_TIMEOUT=300000 as_home "$home" limited 400 claude mcp list >"$home/mcp.log" 2>&1)
  unset CLAUDE_CONFIG_DIR
  if grep -Eq "mostra.*Connected" "$home/mcp.log"; then pass "Claude Code $(claude --version | head -1): the plugin's server started"
  else fail "Claude Code: the plugin's server didn't connect (see $home/mcp.log): $(tail -3 "$home/mcp.log")"; fi
else echo "- Claude Code: not installed, skipped"; fi

if command -v gemini >/dev/null; then
  home="$scratch/gemini"; home_for "$home"
  # Gemini CLI disables a folder's MCP servers until the person trusts it: trust the scratch folder.
  mkdir -p "$home/.gemini"
  node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ [process.argv[2]]: "TRUST_FOLDER" }))' \
    "$(native "$home/.gemini/trustedFolders.json")" "$(native "$scratch")"
  echo y | as_home "$home" perl -e 'alarm 120; exec @ARGV' gemini extensions install "$(native "$plugin")" --consent --skip-settings >"$home/install.log" 2>&1
  (cd "$scratch" && as_home "$home" limited 400 gemini mcp list >"$home/mcp.log" 2>&1)
  if grep -Eq "mostra.*Connected" "$home/mcp.log"; then pass "Gemini CLI $(as_home "$home" gemini --version 2>/dev/null | tail -1): the plugin's server started"
  else fail "Gemini CLI: the plugin's server didn't connect (see $home/mcp.log): $(tail -3 "$home/mcp.log")"; fi
else echo "- Gemini CLI: not installed, skipped"; fi

if command -v codex >/dev/null; then
  home="$scratch/codex"; home_for "$home"
  export CODEX_HOME; CODEX_HOME="$(native "$home")"
  as_home "$home" limited 120 codex plugin marketplace add "$(native "$plugin")" >"$home/add.log" 2>&1
  as_home "$home" limited 120 codex plugin add mostra@mostra >"$home/install.log" 2>&1
  (cd "$scratch" && as_home "$home" limited 400 node "$(native "$here/codex-mcp-status.mjs")" mostra >"$home/mcp.log" 2>"$home/mcp.err")
  unset CODEX_HOME
  if grep -q '"pluginId":"mostra@mostra"' "$home/mcp.log"; then pass "Codex $(codex --version 2>/dev/null | tail -1): the plugin's server started, $(sed -n 's/.*tools: \([^ ]*\).*/\1/p' "$home/mcp.log" | tr ',' '\n' | grep -c .) tools"
  else fail "Codex: the plugin's server didn't start (see $home/mcp.log): $(head -c 400 "$home/mcp.log")"; fi
else echo "- Codex: not installed, skipped"; fi

if command -v copilot >/dev/null; then
  home="$scratch/copilot"; home_for "$home"
  export COPILOT_HOME; COPILOT_HOME="$(native "$home/.copilot")"
  as_home "$home" limited 120 copilot plugin marketplace add "$(native "$plugin")" >"$home/add.log" 2>&1
  as_home "$home" limited 120 copilot plugin install mostra@mostra >"$home/install.log" 2>&1
  (cd "$scratch" && as_home "$home" limited 120 copilot mcp list >"$home/mcp.log" 2>&1)
  unset COPILOT_HOME
  if grep -q "mostra (local)" "$home/mcp.log"; then echo "- Copilot CLI: lists the plugin's server; starting it needs a signed-in session"
  else fail "Copilot CLI: doesn't list the plugin's server (see $home/mcp.log)"; fi
else echo "- Copilot CLI: not installed, skipped"; fi

# D148: nothing reached the collector, and no install ID or queue was written anywhere.
sleep 2
recorded=$(find "$scratch" \( -name telemetry-id -o -name telemetry-queue.ndjson \) 2>/dev/null)
if [ -s "$scratch/collector.log" ] || [ -n "$recorded" ]; then
  fail "D148: telemetry was recorded or sent: $(cat "$scratch/collector.log") $recorded"
else
  pass "D148: no event sent or queued (the collector got nothing; no install ID, no queue)"
fi
exit "$failed"
