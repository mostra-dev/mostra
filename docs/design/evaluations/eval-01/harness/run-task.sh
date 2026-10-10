#!/bin/bash
# One evaluation task: copy a template, let Codex write the page, check it, and optionally run one
# repair turn with the checker's verdict. Usage: run-task.sh <base> <promptIndex> <rep> <port> [repair]
set -u
cd "$(dirname "$0")"
base="$1"; idx="$2"; rep="$3"; port="$4"; repair="${5:-repair}"
id="$base-p$(printf %02d "$idx")-r$rep"
dir="runs/$id"
mkdir -p runs logs
if [ -e "$dir" ]; then echo "exists: $dir" >&2; exit 2; fi
cp -cR "tpl-$base" "$dir"
cp AGENTS.template.md "$dir/AGENTS.md"
task=$(python3 -c "import json,sys; print(json.load(open('prompts.json'))[int(sys.argv[1])])" "$idx")
prompt="Build this page: $task

Write the code only. Don't run install, build, type-check or dev-server commands: a separate checker runs them after you finish."
start=$(date +%s)
codex exec -m gpt-6.1-sol -s workspace-write --skip-git-repo-check --ephemeral --json -C "$dir" "$prompt" < /dev/null > "logs/$id.turn1.jsonl" 2> "logs/$id.turn1.err"
t1=$(( $(date +%s) - start ))
node check.mjs "$dir" "$port" > "logs/$id.check1.json"
mkdir -p "snapshots/$id" && cp -R "$dir/src" "snapshots/$id/src.turn1"
pass1=$(python3 -c "import json; print(json.load(open('logs/$id.check1.json'))['pass'])")
t2=0
if [ "$pass1" != "True" ] && [ "$repair" = "repair" ]; then
  verdict=$(python3 - "$id" <<'PY'
import json, sys
d = json.load(open(f"logs/{sys.argv[1]}.check1.json"))
keep = {k: d[k] for k in ("typecheck", "build", "render", "interaction") if d.get(k)}
print(json.dumps(keep)[:6000])
PY
)
  start=$(date +%s)
  codex exec -m gpt-6.1-sol -s workspace-write --skip-git-repo-check --ephemeral --json -C "$dir" "The checker reported problems with your page. Fix them. Same rules: write code only, don't run build or type-check commands.

Checker verdict (JSON): $verdict" < /dev/null > "logs/$id.turn2.jsonl" 2> "logs/$id.turn2.err"
  t2=$(( $(date +%s) - start ))
  node check.mjs "$dir" "$port" > "logs/$id.check2.json"
fi
python3 summarize-run.py "$id" "$t1" "$t2"
