#!/bin/sh
# Keeps a smoke test's logs after it failed or was stopped (#124), for the workflow to upload: the
# run's own logs and its daemon's, from the work directory smoke.sh or npm-smoke.sh wrote to the
# file `MOSTRA_SMOKE_WORK` named, with capability parameters redacted.
#
#   sh packages/bundle/scripts/keep-logs.sh <work file> <destination>
set -eu

here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=deadline.sh
. "$here/deadline.sh"
if [ ! -f "$1" ]; then
  echo "keep-logs: the smoke test recorded no work directory (it didn't start)"
  exit 0
fi
work=$(cat "$1")
mkdir -p "$2"
find "$work/logs" "$work/home/logs" -type f 2> /dev/null | while IFS= read -r file; do
  kept=$2/${file#"$work"/}
  mkdir -p "$(dirname "$kept")"
  redact < "$file" > "$kept"
done
echo "keep-logs: kept $(find "$2" -type f | wc -l | tr -d ' ') files from $work"
