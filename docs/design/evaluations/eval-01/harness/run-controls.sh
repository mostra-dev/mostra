#!/bin/bash
# Validate the checker on control pages: right and wrong idiom for each base.
set -u
cd "$(dirname "$0")"
mkdir -p controls
port=4910
for spec in radix-ok:radix:aschild radix-wrong:radix:render base-ok:base:render base-wrong:base:aschild; do
  IFS=: read -r name base src <<< "$spec"
  dest="controls/$name"
  if [ ! -d "$dest" ]; then cp -cR "tpl-$base" "$dest"; fi
  cp "controls-src/$src.tsx" "$dest/src/App.tsx"
  port=$((port + 1))
  node check.mjs "$dest" "$port" > "controls/$name.json"
  python3 summarize-one.py "$name" "controls/$name.json"
done
