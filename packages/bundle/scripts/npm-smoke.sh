#!/bin/sh
# The npm path's smoke test (RT-01, RT-12): what `npm create mostra` and `npm install @mostra/cli`
# do, with the release's packed tarballs instead of the registry and its archives as a file:
# mirror.
#
#   sh packages/bundle/scripts/npm-smoke.sh <tarballs dir> <archives dir> <bundle's Node.js version>
#
# With the machine's own Node.js and npm (any version from 22.19; CI uses an older line than the
# bundle's on purpose), it installs the tarballs into a fresh project, runs create-mostra, then
# mostra verify and publish, submits an answer through the shell in the installed bundle's own
# browser, reads it back with mostra wait and results, and checks that every Mostra process ran
# on the bundle's own Node.js (doctor's platform check names it), not the machine's. On Windows it
# runs in Git's sh.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
tarballs=$(cd "$1" && pwd)
archives=$(cd "$2" && pwd)
bundled=$3
work=$(mktemp -d "${TMPDIR:-/tmp}/mostra-npm-smoke-XXXXXX")
mkdir -p "$work/logs" "$work/project" "$work/user"
say() { printf 'npm-smoke: %s\n' "$*"; }
die() { printf 'npm-smoke: FAILED: %s\n' "$*" >&2; exit 1; }

windows=false
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) windows=true ;; esac
# A path as Mostra's programs take it: a Windows path on Windows, else as it is.
native() { if $windows; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

say "the machine's Node.js: $(node --version), npm $(npm --version)"
export MOSTRA_HOME MOSTRA_CONFIG_DIR MOSTRA_CACHE_DIR MOSTRA_BUNDLE_MIRROR DO_NOT_TRACK=1
MOSTRA_HOME=$(native "$work/home")
MOSTRA_CONFIG_DIR=$(native "$work/config")
MOSTRA_CACHE_DIR=$(native "$work/cache")
if $windows; then
  MOSTRA_BUNDLE_MIRROR="file:///$(cygpath -m "$archives")"
else
  # A short runtime directory: macOS caps a socket path at 103 bytes (D82) and its $TMPDIR is long.
  run=$(mktemp -d /tmp/mostra-run-XXXXXX)
  export HOME="$work/user" MOSTRA_RUNTIME_DIR="$run"
  MOSTRA_BUNDLE_MIRROR="file://$archives"
fi

cd "$work/project"
npm init -y > /dev/null
say "npm install of the release's tarballs"
packed=""
for file in $(find "$tarballs" -name '*.tgz' | sort); do packed="$packed $(native "$file")"; done
# shellcheck disable=SC2086
npm install --no-audit --no-fund $packed > "$work/logs/install.log" 2>&1 ||
  die "npm install failed: $(tail -20 "$work/logs/install.log")"

say "create-mostra (installs the pinned bundle from the mirror)"
./node_modules/.bin/create-mostra smoke --json > "$work/logs/create.json" 2> "$work/logs/create.err" ||
  die "create-mostra failed: $(cat "$work/logs/create.json" "$work/logs/create.err")"
grep -q '"ok":true' "$work/logs/create.json" || die "create-mostra said: $(cat "$work/logs/create.json")"
[ -f smoke/index.tsx ] || die "create-mostra wrote no smoke/index.tsx"
# A field the viewer answers through the shell.
cat > smoke/index.tsx <<'EOF'
import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({ title: "npm smoke" });

export default function Page() {
  const [note, setNote] = useField("note", "", { label: "Note" });
  return (
    <main>
      <h1>npm smoke test</h1>
      <label>
        Note <input data-testid="note" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    </main>
  );
}
EOF

say "mostra verify"
./node_modules/.bin/mostra verify smoke --json > "$work/logs/verify.json" 2> "$work/logs/verify.err" ||
  die "verify failed: $(cat "$work/logs/verify.json")"
grep -q '"status":"pass"' "$work/logs/verify.json" || die "verify didn't pass: $(cat "$work/logs/verify.json")"

say "mostra publish"
./node_modules/.bin/mostra publish smoke --json > "$work/logs/publish.json" 2> "$work/logs/publish.err" ||
  die "publish failed: $(cat "$work/logs/publish.json")"
grep -q '"version":1' "$work/logs/publish.json" || die "publish said: $(cat "$work/logs/publish.json")"

# The bundle the bootstrap installed, whose own Node.js and browser play the viewer.
root=$(find "$work/cache/bundles" -mindepth 2 -maxdepth 2 -type d -name 'mostra-*' | head -1)
[ -n "$root" ] || die "no bundle in the cache"
if $windows; then bnode=$root/node/node.exe; else bnode=$root/node/bin/node; fi
field() { "$bnode" -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v))})' "$1"; }
artifact=$(field result.artifactId < "$work/logs/publish.json")
link=$(field result.url < "$work/logs/publish.json")

say "a submission through the shell, in the bundle's browser"
"$bnode" "$(native "$here/submit.mjs")" "$(native "$root")" "$link" "answered through npm" \
  > "$work/logs/submit.out" 2> "$work/logs/submit.err" ||
  die "the submission failed: $(cat "$work/logs/submit.out" "$work/logs/submit.err")"
./node_modules/.bin/mostra wait "$artifact" --until submitted --timeout 30s --json > "$work/logs/wait.json" 2> "$work/logs/wait.err" ||
  die "wait failed: $(cat "$work/logs/wait.json")"
./node_modules/.bin/mostra results "$artifact" --json > "$work/logs/results.json" 2> "$work/logs/results.err" ||
  die "results failed: $(cat "$work/logs/results.json")"
[ "$(field result.answers.note < "$work/logs/results.json")" = "answered through npm" ] ||
  die "results don't hold the answer: $(cat "$work/logs/results.json")"

say "mostra doctor: the bundle's Node.js runs Mostra"
./node_modules/.bin/mostra doctor --json > "$work/logs/doctor.json" 2> "$work/logs/doctor.err" || true
grep -q '"name":"bundle","status":"ok"' "$work/logs/doctor.json" ||
  die "doctor reports no runtime bundle: $(cat "$work/logs/doctor.json")"
grep -q "Node $bundled" "$work/logs/doctor.json" ||
  die "doctor's platform check doesn't name the bundle's Node $bundled: $(cat "$work/logs/doctor.json")"
./node_modules/.bin/mostra daemon stop --json > /dev/null 2>&1 || true

say "passed: logs in $work/logs"
