#!/bin/bash
# Paced evaluation driver (D64): runs the same prompt in both bases at once, pair after pair,
# stops at a token envelope or at the first usage-limit or harness error.
# Usage: drive.sh <rep> <firstPrompt> <lastPrompt> <tokenEnvelope>
set -u
cd "$(dirname "$0")"
rep="$1"; first="$2"; last="$3"; envelope="$4"
spent() { python3 -c "
import json
t=0
for l in open('results.ndjson'):
    r=json.loads(l)
    for k in ('turn1','turn2'):
        u=r[k]['usage']
        if u: t+=u['input']+u['output']
print(t)"; }
for idx in $(seq "$first" "$last"); do
  s=$(spent)
  if [ "$s" -ge "$envelope" ]; then echo "STOP envelope reached: $s tokens"; exit 0; fi
  pids=()
  for base in radix base; do
    id="$base-p$(printf %02d "$idx")-r$rep"
    if [ -e "runs/$id" ]; then continue; fi
    port=$((5000 + idx * 2 + $([ "$base" = base ] && echo 1 || echo 0)))
    bash run-task.sh "$base" "$idx" "$rep" "$port" repair > "logs/$id.summary" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  if grep -l -i -E 'usage limit|rate limit|quota|too many requests|unauthorized|not logged in' logs/*-p$(printf %02d "$idx")-r$rep.turn*.err 2>/dev/null; then
    echo "STOP harness or usage-limit error at prompt $idx"; exit 3
  fi
  echo "done prompt $idx; spent $(spent) tokens"
done
echo "STOP range complete"
