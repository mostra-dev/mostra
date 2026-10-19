#!/bin/sh
# The runtime bundle's smoke test (RT-01), in POSIX sh so it runs where no Node.js exists at all.
#
#   sh packages/bundle/scripts/smoke.sh <archive.tar.gz> <expected sha256>
#
# 1. checks the archive against its SHA-256, as a person or host following the install docs does;
# 2. extracts it and proves a tampered file is refused by the bundle's own setup;
# 3. sets the bundle up, then with no Node.js on PATH runs `mostra new`, `verify` and `publish`
#    for an artifact that imports an on-demand npm package (installed by the bundled pnpm 10);
# 4. moves the bundle to another directory and publishes again from the same home;
# 5. stops the daemon. Every step's output is kept in <work>/logs.
set -eu

archive=$1
expected=$2
work=$(mktemp -d "${TMPDIR:-/tmp}/mostra-smoke-XXXXXX")
mkdir -p "$work/logs"
say() { printf 'smoke: %s\n' "$*"; }
die() { printf 'smoke: FAILED: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) sum() { shasum -a 256 "$1" | cut -d' ' -f1; } ;;
  *) sum() { sha256sum "$1" | cut -d' ' -f1; } ;;
esac

# A PATH with the system's tools and no Node.js: what a machine without Node.js has.
clean_path=/usr/bin:/bin:/usr/sbin:/sbin
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

say "a tampered file is refused"
mkdir -p "$work/t"
tar -xzf "$archive" -C "$work/t"
troot=$(find "$work/t" -mindepth 1 -maxdepth 1 -type d)
printf '\n// tampered\n' >> "$troot/lib/node_modules/@mostra/runtime/dist/bin.js"
if PATH=$clean_path "$troot/bin/mostra-setup" > "$work/logs/tampered.json" 2> "$work/logs/tampered.err"; then
  die "setup accepted a tampered bundle"
fi
grep -q '"MOSTRA_ENV_BUNDLE_INVALID"' "$work/logs/tampered.json" || die "setup's refusal isn't MOSTRA_ENV_BUNDLE_INVALID: $(cat "$work/logs/tampered.json")"
rm -rf "$work/t"

say "setting the bundle up (fetches and checks the verify browser)"
PATH=$clean_path "$root/bin/mostra-setup" > "$work/logs/setup.json" 2> "$work/logs/setup.err" ||
  die "setup failed: $(cat "$work/logs/setup.json" "$work/logs/setup.err")"
grep -q '"status":"ok"' "$work/logs/setup.json" || die "setup said: $(cat "$work/logs/setup.json")"

home=$work/home
export MOSTRA_HOME="$home" MOSTRA_RUNTIME_DIR="$work/run" MOSTRA_CONFIG_DIR="$work/config" HOME="$work/user"
export DO_NOT_TRACK=1
mkdir -p "$HOME"
mostra() { PATH=$clean_path "$root/bin/mostra" "$@"; }

say "no Node.js on PATH: $(PATH=$clean_path command -v node || echo none)"
say "mostra new"
mostra new "$work/art" --title "Smoke" --json > "$work/logs/new.json" 2> "$work/logs/new.err" ||
  die "new failed: $(cat "$work/logs/new.json")"
# An on-demand package (not in the warm set): the bundled pnpm installs it.
cat > "$work/art/index.tsx" <<'EOF'
import { defineArtifact } from "@mostra/react";
import ms from "ms";

export const artifact = defineArtifact({ title: "Smoke" });

export default function Page() {
  return (
    <main>
      <h1>Smoke test</h1>
      <p>One day is {ms("1d")} milliseconds.</p>
    </main>
  );
}
EOF
say "mostra verify"
mostra verify "$work/art" --json > "$work/logs/verify.json" 2> "$work/logs/verify.err" ||
  die "verify failed: $(cat "$work/logs/verify.json")"
grep -q '"status":"pass"' "$work/logs/verify.json" || die "verify didn't pass: $(cat "$work/logs/verify.json")"
say "mostra publish"
mostra publish "$work/art" --json > "$work/logs/publish.json" 2> "$work/logs/publish.err" ||
  die "publish failed: $(cat "$work/logs/publish.json")"
grep -q '"ok":true' "$work/logs/publish.json" || die "publish said: $(cat "$work/logs/publish.json")"
grep -q '"version":1' "$work/logs/publish.json" || die "the first publish isn't version 1"
mostra daemon stop --json > /dev/null 2>&1 || true

say "moving the bundle"
mv "$root" "$work/moved"
root=$work/moved
printf '\n// a second version\n' >> "$work/art/index.tsx"
mostra publish "$work/art" --json > "$work/logs/publish2.json" 2> "$work/logs/publish2.err" ||
  die "publish from the moved bundle failed: $(cat "$work/logs/publish2.json")"
grep -q '"version":2' "$work/logs/publish2.json" || die "the moved bundle's publish isn't version 2: $(cat "$work/logs/publish2.json")"
mostra doctor --json > "$work/logs/doctor.json" 2> "$work/logs/doctor.err" || die "doctor failed: $(cat "$work/logs/doctor.json")"
mostra daemon stop --json > /dev/null 2>&1 || true

say "passed: logs in $work/logs"
