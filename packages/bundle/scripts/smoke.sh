#!/bin/sh
# The runtime bundle's smoke test (RT-01, RT-12), in POSIX sh so it runs where no Node.js exists
# at all (on Windows in Git's sh, whose tools stand in for a person's).
#
#   sh packages/bundle/scripts/smoke.sh <archive.tar.gz> <expected sha256>
#
# 1. checks the archive against its SHA-256, as a person or host following the install docs does;
# 2. extracts it and proves a tampered file is refused by the bundle's own setup;
# 3. sets the bundle up, then with no Node.js on PATH runs `mostra new`, `verify` and `publish`
#    for an artifact that imports an on-demand npm package (installed by the bundled pnpm 10);
# 4. submits an answer through the shell, in the bundle's own browser driven by the bundle's own
#    Playwright (submit.mjs, on the bundle's Node.js), then `mostra wait` and `mostra results`;
# 5. moves the bundle to another directory and publishes again from the same home (a Windows
#    bundle, whose junctions name the old directory, is set up again first, D153);
# 6. stops the daemon. Every step's output is kept in <work>/logs.
set -eu

archive=$1
expected=$2
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/mostra-smoke-XXXXXX")
mkdir -p "$work/logs"
say() { printf 'smoke: %s\n' "$*"; }
die() { printf 'smoke: FAILED: %s\n' "$*" >&2; exit 1; }

windows=false
case "$(uname -s)" in
  Darwin) sum() { shasum -a 256 "$1" | cut -d' ' -f1; } ;;
  MINGW* | MSYS* | CYGWIN*) windows=true; sum() { sha256sum "$1" | cut -d' ' -f1; } ;;
  *) sum() { sha256sum "$1" | cut -d' ' -f1; } ;;
esac
# A path as the bundle's programs take it: a Windows path on Windows, else as it is.
native() { if $windows; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

# A PATH with the system's tools and no Node.js: what a machine without Node.js has.
if $windows; then
  clean_path=/usr/bin:/bin:$(cygpath -u "$SYSTEMROOT")/System32:$(cygpath -u "$SYSTEMROOT"):$(cygpath -u "$SYSTEMROOT")/System32/WindowsPowerShell/v1.0
else
  clean_path=/usr/bin:/bin:/usr/sbin:/sbin
fi
if PATH=$clean_path command -v node >/dev/null 2>&1; then
  # Some images install Node.js in /usr/bin; hide it behind a directory that shadows it.
  mkdir -p "$work/shadow"
  printf '#!/bin/sh\necho "node is hidden by the smoke test" >&2\nexit 127\n' > "$work/shadow/node"
  chmod +x "$work/shadow/node"
  clean_path=$work/shadow:$clean_path
fi

say "checking the archive's SHA-256"
actual=$(sum "$archive")
[ "$actual" = "$expected" ] || die "the archive's SHA-256 is $actual, not $expected"

say "extracting"
mkdir -p "$work/a"
tar -xzf "$archive" -C "$work/a"
root=$(find "$work/a" -mindepth 1 -maxdepth 1 -type d)
[ -f "$root/bundle.json" ] || die "no bundle.json at the archive's top directory"
if $windows; then
  # A Windows archive holds no links (D153): setup makes them.
  links=$(find "$root" -type l | head -5)
  [ -z "$links" ] || die "the Windows archive holds links: $links"
fi

say "a tampered file is refused"
mkdir -p "$work/t"
tar -xzf "$archive" -C "$work/t"
troot=$(find "$work/t" -mindepth 1 -maxdepth 1 -type d)
printf '\n// tampered\n' >> "$troot/lib/node_modules/@mostra/runtime/dist/bin.js"
if PATH=$clean_path "$troot/bin/mostra-setup" > "$work/logs/tampered.json" 2> "$work/logs/tampered.err"; then
  die "setup accepted a tampered bundle"
fi
grep -q '"MOSTRA_ENV_BUNDLE_INVALID"' "$work/logs/tampered.json" || die "setup's refusal isn't MOSTRA_ENV_BUNDLE_INVALID: $(cat "$work/logs/tampered.json" "$work/logs/tampered.err")"
rm -rf "$work/t"

say "setting the bundle up (fetches and checks the verify browser)"
started=$(date +%s)
PATH=$clean_path "$root/bin/mostra-setup" > "$work/logs/setup.json" 2> "$work/logs/setup.err" ||
  die "setup failed: $(cat "$work/logs/setup.json" "$work/logs/setup.err")"
grep -q '"status":"ok"' "$work/logs/setup.json" || die "setup said: $(cat "$work/logs/setup.json")"
say "setup took $(( $(date +%s) - started )) s"

home=$work/home
export MOSTRA_HOME
MOSTRA_HOME=$(native "$home")
if $windows; then
  export MOSTRA_CONFIG_DIR USERPROFILE
  MOSTRA_CONFIG_DIR=$(native "$work/config")
  mkdir -p "$work/user"
  USERPROFILE=$(native "$work/user")
else
  # The control socket lives in the runtime directory, and a socket path is at most 103 bytes on
  # macOS (D82), where $TMPDIR is long: a short directory of its own.
  run=$(mktemp -d /tmp/mostra-run-XXXXXX)
  export MOSTRA_RUNTIME_DIR="$run" MOSTRA_CONFIG_DIR="$work/config" HOME="$work/user"
  mkdir -p "$HOME"
fi
export DO_NOT_TRACK=1
mostra() { PATH=$clean_path "$root/bin/mostra" "$@"; }
# The bundle's own Node.js, to read JSON and to run the viewer: never one on the machine.
bnode() {
  if $windows; then PATH=$clean_path "$root/node/node.exe" "$@"; else PATH=$clean_path "$root/node/bin/node" "$@"; fi
}
field() { bnode -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v))})' "$1"; }

say "no Node.js on PATH: $(PATH=$clean_path command -v node || echo none)"
say "mostra new"
art=$(native "$work/art")
mostra new "$art" --title "Smoke" --json > "$work/logs/new.json" 2> "$work/logs/new.err" ||
  die "new failed: $(cat "$work/logs/new.json")"
# An on-demand package (not in the warm set): the bundled pnpm installs it. A field the viewer
# answers through the shell.
cat > "$work/art/index.tsx" <<'EOF'
import { defineArtifact, useField } from "@mostra/react";
import ms from "ms";

export const artifact = defineArtifact({ title: "Smoke" });

export default function Page() {
  const [note, setNote] = useField("note", "", { label: "Note" });
  return (
    <main>
      <h1>Smoke test</h1>
      <p>One day is {ms("1d")} milliseconds.</p>
      <label>
        Note <input data-testid="note" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    </main>
  );
}
EOF
say "mostra verify"
started=$(date +%s)
mostra verify "$art" --json > "$work/logs/verify.json" 2> "$work/logs/verify.err" ||
  die "verify failed: $(cat "$work/logs/verify.json")"
grep -q '"status":"pass"' "$work/logs/verify.json" || die "verify didn't pass: $(cat "$work/logs/verify.json")"
say "verify took $(( $(date +%s) - started )) s"
say "mostra publish"
mostra publish "$art" --json > "$work/logs/publish.json" 2> "$work/logs/publish.err" ||
  die "publish failed: $(cat "$work/logs/publish.json")"
grep -q '"ok":true' "$work/logs/publish.json" || die "publish said: $(cat "$work/logs/publish.json")"
grep -q '"version":1' "$work/logs/publish.json" || die "the first publish isn't version 1"
artifact=$(field result.artifactId < "$work/logs/publish.json")
link=$(field result.url < "$work/logs/publish.json")

say "a submission through the shell, in the bundle's browser"
bnode "$(native "$here/submit.mjs")" "$(native "$root")" "$link" "answered by the smoke test" \
  > "$work/logs/submit.out" 2> "$work/logs/submit.err" ||
  die "the submission failed: $(cat "$work/logs/submit.out" "$work/logs/submit.err")"
say "mostra wait and mostra results"
mostra wait "$artifact" --until submitted --timeout 30s --json > "$work/logs/wait.json" 2> "$work/logs/wait.err" ||
  die "wait failed: $(cat "$work/logs/wait.json")"
grep -q '"satisfied"' "$work/logs/wait.json" || die "wait said: $(cat "$work/logs/wait.json")"
mostra results "$artifact" --json > "$work/logs/results.json" 2> "$work/logs/results.err" ||
  die "results failed: $(cat "$work/logs/results.json")"
[ "$(field result.answers.note < "$work/logs/results.json")" = "answered by the smoke test" ] ||
  die "results don't hold the answer: $(cat "$work/logs/results.json")"
[ "$(field result.submission.channel < "$work/logs/results.json")" = "shell" ] ||
  die "the submission isn't the shell's: $(cat "$work/logs/results.json")"
mostra daemon stop --json > /dev/null 2>&1 || true

say "moving the bundle"
# Windows refuses to move a directory a process still has open: the daemon may take a moment.
moved=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if mv "$root" "$work/moved" 2> "$work/logs/mv.err"; then moved=true; break; fi
  sleep 1
done
$moved || die "the bundle couldn't be moved: $(cat "$work/logs/mv.err")"
root=$work/moved
printf '\n// a second version\n' >> "$work/art/index.tsx"
mostra publish "$art" --json > "$work/logs/publish2.json" 2> "$work/logs/publish2.err" ||
  die "publish from the moved bundle failed: $(cat "$work/logs/publish2.json" "$work/logs/publish2.err")"
grep -q '"version":2' "$work/logs/publish2.json" || die "the moved bundle's publish isn't version 2: $(cat "$work/logs/publish2.json")"
mostra doctor --json > "$work/logs/doctor.json" 2> "$work/logs/doctor.err" || die "doctor failed: $(cat "$work/logs/doctor.json")"
mostra daemon stop --json > /dev/null 2>&1 || true

say "passed: logs in $work/logs"
