#!/usr/bin/env bash
# Loads the harness plugin in every harness CLI this machine has, each in a scratch home, and
# reports whether each found the Skill (AX-10, D162; docs/agents/check-harness-plugins.md).
#
#   tools/plugins/try-harnesses.sh [<scratch dir>]
#
# It builds the plugin with tools/plugins/cli.ts, then, for each CLI on PATH (or in
# $MOSTRA_HARNESS_BIN, a directory of them): Claude Code (`claude plugin validate --strict`,
# marketplace add, install, details), Codex (marketplace add, plugin add, the cached SKILL.md),
# Gemini CLI (extensions install, list), GitHub Copilot CLI (marketplace add, plugin install), the
# `skills` CLI (`skills add --list`) and skills-ref (`agentskills validate`, through uvx). A
# harness that isn't installed is reported as skipped. Nothing outside the scratch directory is
# written: every harness runs with its home there. Exit 1 when any harness that ran failed.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="${1:-$(mktemp -d "${TMPDIR:-/tmp}/mostra-harnesses.XXXXXX")}"
mkdir -p "$scratch"
plugin="$scratch/plugin"
if [ -e "$plugin" ]; then
  echo "✗ $plugin exists; give an empty scratch directory" >&2
  exit 2
fi
node "$root/tools/plugins/cli.ts" build --out "$plugin" >/dev/null || exit 1
node "$root/tools/plugins/cli.ts" check "$plugin" || exit 1

export PATH="${MOSTRA_HARNESS_BIN:+$MOSTRA_HARNESS_BIN:}$PATH"
failed=0
pass() { echo "✓ $1"; }
fail() { echo "✗ $1"; failed=1; }
skip() { echo "- $1: not installed, skipped"; }
# Runs a command with a time limit and stdin closed, so a prompt can't hang the run.
limited() { perl -e 'alarm shift; exec @ARGV' "$@" </dev/null; }

if command -v claude >/dev/null; then
  home="$scratch/claude"; mkdir -p "$home"
  if CLAUDE_CONFIG_DIR="$home" limited 120 claude plugin validate "$plugin" --strict >"$home/validate.log" 2>&1 &&
    CLAUDE_CONFIG_DIR="$home" limited 120 claude plugin marketplace add "$plugin" >"$home/add.log" 2>&1 &&
    CLAUDE_CONFIG_DIR="$home" limited 120 claude plugin install mostra@mostra >"$home/install.log" 2>&1 &&
    CLAUDE_CONFIG_DIR="$home" limited 120 claude plugin details mostra@mostra >"$home/details.log" 2>&1 &&
    grep -q "Skills (1)  mostra" "$home/details.log"; then
    pass "Claude Code $(claude --version | head -1): validated (--strict), installed, Skill mostra found"
  else
    fail "Claude Code: see $home/*.log"
  fi
else skip "Claude Code"; fi

if command -v codex >/dev/null; then
  home="$scratch/codex"; mkdir -p "$home"
  if CODEX_HOME="$home" limited 120 codex plugin marketplace add "$plugin" >"$home/add.log" 2>&1 &&
    CODEX_HOME="$home" limited 120 codex plugin add mostra@mostra >"$home/install.log" 2>&1 &&
    cmp -s "$(find "$home/plugins/cache" -path '*/skills/mostra/SKILL.md' | head -1)" "$plugin/skills/mostra/SKILL.md"; then
    pass "Codex $(codex --version 2>/dev/null | tail -1): installed, its cached SKILL.md is the plugin's"
  else
    fail "Codex: see $home/*.log"
  fi
else skip "Codex"; fi

if command -v gemini >/dev/null; then
  home="$scratch/gemini"; mkdir -p "$home"
  # Gemini asks whether to trust the folder even with --consent: answer it.
  if echo y | HOME="$home" perl -e 'alarm 120; exec @ARGV' gemini extensions install "$plugin" --consent --skip-settings >"$home/install.log" 2>&1 &&
    HOME="$home" limited 120 gemini extensions list >"$home/list.log" 2>&1 &&
    grep -q "^  mostra:" "$home/list.log"; then
    pass "Gemini CLI $(HOME="$home" gemini --version 2>/dev/null | tail -1): installed, agent skill mostra listed"
  else
    fail "Gemini CLI: see $home/*.log"
  fi
else skip "Gemini CLI"; fi

if command -v copilot >/dev/null; then
  home="$scratch/copilot"; mkdir -p "$home"
  if HOME="$home" COPILOT_HOME="$home/.copilot" limited 120 copilot plugin marketplace add "$plugin" >"$home/add.log" 2>&1 &&
    HOME="$home" COPILOT_HOME="$home/.copilot" limited 120 copilot plugin install mostra@mostra >"$home/install.log" 2>&1 &&
    grep -q "Installed 1 skill" "$home/install.log"; then
    pass "Copilot CLI $(HOME="$home" copilot --version 2>/dev/null | head -1): installed 1 skill"
  else
    fail "Copilot CLI: see $home/*.log"
  fi
else skip "Copilot CLI"; fi

if command -v skills >/dev/null; then
  home="$scratch/skills"; mkdir -p "$home"
  if (cd "$home" && DO_NOT_TRACK=1 DISABLE_TELEMETRY=1 limited 120 skills add "$plugin" --list >"$home/list.log" 2>&1) &&
    grep -q "mostra" "$home/list.log"; then
    pass "skills CLI $(skills --version 2>/dev/null | tail -1): lists the Skill mostra"
  else
    fail "skills CLI: see $home/list.log"
  fi
else skip "skills CLI"; fi

if command -v uvx >/dev/null; then
  if limited 300 uvx --from skills-ref==0.1.1 agentskills validate "$plugin/skills/mostra" >"$scratch/skills-ref.log" 2>&1; then
    pass "skills-ref 0.1.1: $(tail -1 "$scratch/skills-ref.log")"
  else
    fail "skills-ref: see $scratch/skills-ref.log"
  fi
else skip "skills-ref (uvx)"; fi

echo "scratch: $scratch"
exit "$failed"
