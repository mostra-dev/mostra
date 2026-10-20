#!/usr/bin/env bash
# Mirza's one-time npm steps for the first Mostra release (EN-05, D67; REPO_STANDARDS §9). Run it
# signed in to npm as an owner of the @mostra scope and of create-mostra, with 2FA on the account,
# in a terminal, right before the version pull request merges (or before the run that finishes a
# release): each trusted-publisher configuration must publish within 2 days or it expires.
#
#   tools/release/npm-setup.sh [package…]           does it, for every package or those named
#   tools/release/npm-setup.sh --check [package…]   only reports each package's state
#
# For each package of the fixed release group (.changeset/config.json):
#   1. a package that isn't on npm yet gets a placeholder, 0.0.0-placeholder (npm configures
#      trusted publishing only for a package that exists);
#   2. its trusted publisher: GitHub Actions, mostra-dev/mostra, workflow release.yml,
#      environment release, direct `npm publish` allowed; one that names anything else stops the
#      script (npm allows one per package: revoke it first);
#   3. "Require two-factor authentication and disallow tokens" (`npm access set mfa=publish`).
#
# It never guesses: a state npm doesn't answer clearly (a list it can't read, a one-time password
# it wasn't given) stops the script with what to do. The first step authenticates in this
# terminal; on npm's page, choose "skip two-factor authentication for the next 5 minutes" so the
# rest goes through (npm's own advice for bulk use). When that window runs out part-way, npm asks
# again for the package it reached. A run that stops can simply be run again: what is done stays.
set -euo pipefail

# npm trust needs npm 11.15 or later; 11.21.0 runs on Node.js 20.17 and 22.9 or later.
NPM=(npx --yes npm@11.21.0)
REPO=mostra-dev/mostra
WORKFLOW=release.yml
ENVIRONMENT=release
root=$(cd "$(dirname "$0")/../.." && pwd)
check=false
if [ "${1:-}" = "--check" ]; then
  check=true
  shift
fi

group=$(node -e 'console.log(require(process.argv[1]).fixed[0].join("\n"))' "$root/.changeset/config.json")
packages=$group
if [ "$#" -gt 0 ]; then
  for name in "$@"; do
    printf '%s\n' "$group" | grep -qxF -- "$name" || { echo "$name isn't in the release group: $(printf '%s ' "$group" | tr '\n' ' ')" >&2; exit 2; }
  done
  packages=$(printf '%s\n' "$@")
fi
"${NPM[@]}" whoami > /dev/null || { echo "Sign in first: npx --yes npm@11.21.0 login" >&2; exit 1; }

trusted_state() {
  local out
  out=$("${NPM[@]}" trust list "$1" --json 2> /dev/null) || true
  # none, ours, other <entries> or unreadable <why> (tools/release/trust-state.ts): never a guess.
  printf '%s' "$out" | node "$root/tools/release/trust-state.ts" "$REPO" "$WORKFLOW" "$ENVIRONMENT"
}

# The state, asking for the second factor again in this terminal when npm wants it (the 5-minute
# window ran out part-way), once; still unreadable after that is reported, never guessed.
state_of() {
  local state
  state=$(trusted_state "$1")
  if ! $check && [ "${state#unreadable EOTP}" != "$state" ]; then
    echo "   npm wants your second factor again (the 5-minute window ran out); asking for it now." >&2
    # stdout stays this terminal: npm prompts only when stdin and stdout are both terminals.
    "${NPM[@]}" trust list "$1" >&2 || true
    state=$(trusted_state "$1")
  fi
  echo "$state"
}

if ! $check; then
  # Authenticate once, in this terminal, so the captured calls below don't need a second factor.
  first=$(printf '%s\n' "$packages" | head -1)
  echo "npm asks for your second factor once; choose \"skip two-factor authentication for the next 5 minutes\"."
  # Its stdout stays this terminal: npm prompts only when stdin and stdout are both terminals.
  "${NPM[@]}" trust list "$first" || true
fi

for name in $packages; do
  echo "== $name"
  if "${NPM[@]}" view "$name" name > /dev/null 2>&1; then exists=true; else exists=false; fi
  state=$(state_of "$name")
  echo "   on npm: $exists; trusted publisher: $state"
  $check && continue

  if ! $exists; then
    dir=$(mktemp -d)
    cat > "$dir/package.json" <<EOF
{
  "name": "$name",
  "version": "0.0.0-placeholder",
  "description": "Placeholder for Mostra's first release, which publishes through trusted publishing.",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "git+https://github.com/$REPO.git" }
}
EOF
    printf '# %s\n\nA placeholder: the first Mostra release replaces it. https://github.com/%s\n' "$name" "$REPO" > "$dir/README.md"
    (cd "$dir" && "${NPM[@]}" publish --access public --tag placeholder)
    rm -rf "$dir"
    state=$(state_of "$name")
  fi
  case "$state" in
    none)
      "${NPM[@]}" trust github "$name" --repo "$REPO" --file "$WORKFLOW" --env "$ENVIRONMENT" --allow-publish --yes
      sleep 2
      state=$(state_of "$name")
      [ "$state" = ours ] || { echo "   ✗ after configuring it, npm reports: $state" >&2; exit 1; }
      echo "   ✓ trusted publisher configured: $REPO, $WORKFLOW, environment $ENVIRONMENT"
      ;;
    ours) echo "   ✓ trusted publisher already configured: $REPO, $WORKFLOW, environment $ENVIRONMENT" ;;
    other*)
      echo "   ✗ another trusted publisher is configured: ${state#other }" >&2
      echo "     Revoke it (npx --yes npm@11.21.0 trust revoke $name --id <id>), then run this again." >&2
      exit 1
      ;;
    *)
      echo "   ✗ npm didn't say which trusted publisher $name has (${state#unreadable }); nothing was guessed." >&2
      echo "     Run this again for it ($0 $name); when npm asks for your second factor, choose to skip it for 5 minutes." >&2
      exit 1
      ;;
  esac
  "${NPM[@]}" access set mfa=publish "$name"
  sleep 2
done

if $check; then
  echo
  echo "Checked only; nothing changed. \"unreadable EOTP\" means npm wanted a second factor: run without --check."
else
  echo
  echo "Done: $(printf '%s\n' "$packages" | wc -l | tr -d ' ') packages have their trusted publisher and disallow tokens. The next release run must"
  echo "publish within 2 days, before the configurations expire."
fi
