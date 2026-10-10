#!/bin/bash
# EVAL-01b: same task as run-task.sh, authored by Claude Code in print mode.
# Usage: run-task-claude.sh <base> <promptIndex> <rep> <port> [repair]   (env MODEL, default sonnet)
set -u
cd "$(dirname "$0")"
base="$1"; idx="$2"; rep="$3"; port="$4"; repair="${5:-repair}"; model="${MODEL:-sonnet}"
id="$base-p$(printf %02d "$idx")-r$rep"
R=runs-claude; L=logs-claude; S=snapshots-claude
dir="$R/$id"
mkdir -p "$R" "$L"
if [ -e "$dir" ]; then echo "exists: $dir" >&2; exit 2; fi
cp -cR "tpl-$base" "$dir"
# Same project note as the Codex runs; Claude Code reads CLAUDE.md, Codex reads AGENTS.md.
cp AGENTS.template.md "$dir/AGENTS.md"; cp AGENTS.template.md "$dir/CLAUDE.md"
task=$(python3 -c "import json,sys; print(json.load(open('prompts.json'))[int(sys.argv[1])])" "$idx")
prompt="Build this page: $task

Write the code only. Don't run install, build, type-check or dev-server commands: a separate checker runs them after you finish."
run_claude() {  # $1 prompt, $2 turn name
  (cd "$dir" && claude -p "$1" --model "$model" --output-format json --permission-mode dontAsk \
     --allowedTools "Read" "Write" "Edit" "MultiEdit" "Glob" "Grep" "LS" \
     --setting-sources project --strict-mcp-config --no-session-persistence < /dev/null) \
     > "$L/$id.$2.json" 2> "$L/$id.$2.err"
}
start=$(date +%s); run_claude "$prompt" turn1; t1=$(( $(date +%s) - start ))
node check.mjs "$dir" "$port" > "$L/$id.check1.json"
mkdir -p "$S/$id" && cp -R "$dir/src" "$S/$id/src.turn1"
pass1=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['pass'])" "$L/$id.check1.json")
t2=0
if [ "$pass1" != "True" ] && [ "$repair" = "repair" ]; then
  verdict=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
print(json.dumps({k: d[k] for k in ('typecheck', 'build', 'render', 'interaction') if d.get(k)})[:6000])" "$L/$id.check1.json")
  start=$(date +%s)
  run_claude "The checker reported problems with your page. Fix them. Same rules: write code only, don't run build or type-check commands.

Checker verdict (JSON): $verdict" turn2
  t2=$(( $(date +%s) - start ))
  node check.mjs "$dir" "$port" > "$L/$id.check2.json"
fi
python3 summarize-claude.py "$id" "$t1" "$t2" "$L"
