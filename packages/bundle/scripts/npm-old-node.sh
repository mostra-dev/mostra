#!/bin/sh
# The npm path on a Node.js too old to start Mostra (RT-01, D142): `mostra` and `npm create mostra`
# refuse it at once with MOSTRA_ENV_NODE_UNSUPPORTED (exit 3, one --json envelope), before
# anything that needs a newer Node.js loads, and download nothing.
#
#   sh packages/bundle/scripts/npm-old-node.sh <tarballs dir>
set -eu
tarballs=$(cd "$1" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/mostra-old-node-XXXXXX")
die() { printf 'npm-old-node: FAILED: %s\n' "$*" >&2; exit 1; }
printf "npm-old-node: the machine's Node.js: %s\n" "$(node --version)"
export HOME="$work/user" MOSTRA_CACHE_DIR="$work/cache" DO_NOT_TRACK=1
mkdir -p "$HOME" "$work/project"
cd "$work/project"
npm init -y > /dev/null
# Installed with npm 11.21.0 (it supports Node.js 20.17 and later): Node.js 20's own npm 10 crashes
# installing a set of local tarballs that depend on each other ("Cannot read properties of null
# (reading 'edgesOut')"), which isn't what this checks. The binaries below still run on Node.js 20.
# shellcheck disable=SC2046
npx --yes npm@11.21.0 install --no-audit --no-fund $(find "$tarballs" -name '*.tgz' | sort) > "$work/install.log" 2>&1 ||
  die "npm install failed: $(tail -20 "$work/install.log")"
for bin in mostra create-mostra; do
  set +e
  "./node_modules/.bin/$bin" --json > "$work/out.json" 2> "$work/out.err"
  code=$?
  set -e
  [ "$code" = 3 ] || die "$bin exited $code, not 3: $(cat "$work/out.json" "$work/out.err")"
  [ "$(wc -l < "$work/out.json" | tr -d ' ')" = 1 ] || die "$bin printed more than one line: $(cat "$work/out.json")"
  grep -q '"code":"MOSTRA_ENV_NODE_UNSUPPORTED"' "$work/out.json" || die "$bin said: $(cat "$work/out.json")"
done
[ ! -d "$work/cache/bundles" ] || die "a bundle was downloaded on a Node.js that can't run the bootstrap"
printf 'npm-old-node: passed\n'
