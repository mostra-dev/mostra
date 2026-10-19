#!/bin/sh
# The npm path's smoke test (RT-01): what `npm create mostra` and `npm install @mostra/cli` do,
# with the release's packed tarballs instead of the registry and its archives as a file: mirror.
#
#   sh packages/bundle/scripts/npm-smoke.sh <tarballs dir> <archives dir> <bundle's Node.js version>
#
# With the machine's own Node.js and npm (any version from 22.19; CI uses an older line than the
# bundle's on purpose), it installs the tarballs into a fresh project, runs create-mostra, then
# mostra verify and publish, and checks that every Mostra process ran on the bundle's own Node.js
# (doctor's platform check names it), not the machine's.
set -eu

tarballs=$(cd "$1" && pwd)
archives=$(cd "$2" && pwd)
bundled=$3
work=$(mktemp -d "${TMPDIR:-/tmp}/mostra-npm-smoke-XXXXXX")
mkdir -p "$work/logs" "$work/project" "$work/user"
say() { printf 'npm-smoke: %s\n' "$*"; }
die() { printf 'npm-smoke: FAILED: %s\n' "$*" >&2; exit 1; }

say "the machine's Node.js: $(node --version), npm $(npm --version)"
export HOME="$work/user" MOSTRA_HOME="$work/home" MOSTRA_RUNTIME_DIR="$work/run"
export MOSTRA_CONFIG_DIR="$work/config" MOSTRA_CACHE_DIR="$work/cache" DO_NOT_TRACK=1
export MOSTRA_BUNDLE_MIRROR="file://$archives"

cd "$work/project"
npm init -y > /dev/null
say "npm install of the release's tarballs"
# shellcheck disable=SC2046
npm install --no-audit --no-fund $(find "$tarballs" -name '*.tgz' | sort) > "$work/logs/install.log" 2>&1 ||
  die "npm install failed: $(tail -20 "$work/logs/install.log")"

say "create-mostra (installs the pinned bundle from the mirror)"
./node_modules/.bin/create-mostra smoke --json > "$work/logs/create.json" 2> "$work/logs/create.err" ||
  die "create-mostra failed: $(cat "$work/logs/create.json" "$work/logs/create.err")"
grep -q '"ok":true' "$work/logs/create.json" || die "create-mostra said: $(cat "$work/logs/create.json")"
[ -f smoke/index.tsx ] || die "create-mostra wrote no smoke/index.tsx"

say "mostra verify"
./node_modules/.bin/mostra verify smoke --json > "$work/logs/verify.json" 2> "$work/logs/verify.err" ||
  die "verify failed: $(cat "$work/logs/verify.json")"
grep -q '"status":"pass"' "$work/logs/verify.json" || die "verify didn't pass: $(cat "$work/logs/verify.json")"

say "mostra publish"
./node_modules/.bin/mostra publish smoke --json > "$work/logs/publish.json" 2> "$work/logs/publish.err" ||
  die "publish failed: $(cat "$work/logs/publish.json")"
grep -q '"version":1' "$work/logs/publish.json" || die "publish said: $(cat "$work/logs/publish.json")"

say "mostra doctor: the bundle's Node.js runs Mostra"
./node_modules/.bin/mostra doctor --json > "$work/logs/doctor.json" 2> "$work/logs/doctor.err" || true
grep -q '"name":"bundle","status":"ok"' "$work/logs/doctor.json" ||
  die "doctor reports no runtime bundle: $(cat "$work/logs/doctor.json")"
grep -q "Node $bundled" "$work/logs/doctor.json" ||
  die "doctor's platform check doesn't name the bundle's Node $bundled: $(cat "$work/logs/doctor.json")"
./node_modules/.bin/mostra daemon stop --json > /dev/null 2>&1 || true

say "passed: logs in $work/logs"
