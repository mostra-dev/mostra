#!/usr/bin/env bash
# Mirza's one-time npm steps for the first Mostra release (EN-05, D67; REPO_STANDARDS §9). Run it
# signed in to npm as an owner of the @mostra scope and of create-mostra, with 2FA on the account,
# in a terminal, right before the version pull request merges (or before the run that finishes a
# release): each trusted-publisher configuration must publish within 2 days or it expires.
#
#   tools/release/npm-setup.sh            does it
#   tools/release/npm-setup.sh --check    only reports each package's state
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
# rest goes through (npm's own advice for bulk use). A run that stops can simply be run again.
set -euo pipefail

# npm trust needs npm 11.15 or later; 11.21.0 runs on Node.js 20.17 and 22.9 or later.
NPM=(npx --yes npm@11.21.0)
REPO=mostra-dev/mostra
WORKFLOW=release.yml
ENVIRONMENT=release
root=$(cd "$(dirname "$0")/../.." && pwd)
check=false
[ "${1:-}" = "--check" ] && check=true

packages=$(node -e 'console.log(require(process.argv[1]).fixed[0].join("\n"))' "$root/.changeset/config.json")
"${NPM[@]}" whoami > /dev/null || { echo "Sign in first: npx --yes npm@11.21.0 login" >&2; exit 1; }

trusted_state() {
  local out
  out=$("${NPM[@]}" trust list "$1" --json 2> /dev/null) || true
  # none, ours, other <entries> or unreadable <why> (tools/release/trust-state.ts): never a guess.
  printf '%s' "$out" | node "$root/tools/release/trust-state.ts" "$REPO" "$WORKFLOW" "$ENVIRONMENT"
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
  state=$(trusted_state "$name")
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
    state=$(trusted_state "$name")
  fi
  case "$state" in
    none)
      "${NPM[@]}" trust github "$name" --repo "$REPO" --file "$WORKFLOW" --env "$ENVIRONMENT" --allow-publish --yes
      sleep 2
      state=$(trusted_state "$name")
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
      echo "     Run this again; when npm asks for your second factor, choose to skip it for 5 minutes." >&2
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
  echo "Done: every package has its trusted publisher and disallows tokens. The next release run must"
  echo "publish within 2 days, before the configurations expire."
fi
