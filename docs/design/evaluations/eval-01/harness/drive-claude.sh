#!/bin/bash
# Paced Claude Code driver for EVAL-01b (D64): one prompt in both bases at once, pair after pair, over an
# explicit prompt list. Stops at the token envelope, or at the first usage-limit, auth or harness error.
# Usage: MODEL=<model> drive-claude.sh <rep> <tokenEnvelope> <prompt> [<prompt> ...]
set -u
cd "$(dirname "$0")"
rep="$1"; envelope="$2"; shift 2
touch results.claude.ndjson
spent() { python3 -c "
import json
t=0
for l in open('results.claude.ndjson'):
    r=json.loads(l)
    for k in ('turn1','turn2'):
        u=r[k]['usage']
        if u and 'input' in u: t+=u['input']+u['output']
print(t)"; }
for idx in "$@"; do
  s=$(spent)
  if [ "$s" -ge "$envelope" ]; then echo "STOP envelope reached: $s tokens"; exit 0; fi
  pids=()
  for base in radix base; do
    id="$base-p$(printf %02d "$idx")-r$rep"
    if [ -e "runs-claude/$id" ]; then continue; fi
    port=$((6000 + idx * 2 + $([ "$base" = base ] && echo 1 || echo 0)))
    mkdir -p logs-claude
    bash run-task-claude.sh "$base" "$idx" "$rep" "$port" repair > "logs-claude/$id.summary" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  pat="logs-claude/*-p$(printf %02d "$idx")-r$rep"
  if grep -l -i -E 'usage limit|rate limit|quota|too many requests|unauthorized|not logged in|invalid api key|please run /login' $pat.turn*.err $pat.turn*.json 2>/dev/null; then
    echo "STOP usage-limit, auth or harness error at prompt $idx"; exit 3
  fi
  if grep -l '"is_error": true' $pat.summary 2>/dev/null; then echo "STOP model call reported an error at prompt $idx"; exit 3; fi
  echo "done prompt $idx; spent $(spent) tokens"
done
echo "STOP list complete"
