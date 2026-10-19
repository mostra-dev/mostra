#!/usr/bin/env bash
# Mirza's one-time npm steps for the first Mostra release (EN-05, D67; REPO_STANDARDS §9). Run it
# signed in to npm as an owner of the @mostra scope and of create-mostra, with 2FA on the account,
# right after the WP-11 pull request merges and right before the version pull request merges:
# each trusted-publisher configuration must publish within 2 days or it expires.
#
#   tools/release/npm-setup.sh            does it
#   tools/release/npm-setup.sh --check    only reports each package's state
#
# For each package of the fixed release group (.changeset/config.json):
#   1. a package that isn't on npm yet gets a placeholder, 0.0.0-placeholder (npm configures
#      trusted publishing only for a package that exists);
#   2. its trusted publisher: GitHub Actions, mostra-dev/mostra, workflow release.yml,
#      environment release, direct `npm publish` allowed;
#   3. "Require two-factor authentication and disallow tokens" (`npm access set mfa=publish`).
#
# npm asks for a second factor on the first change; choose "skip two-factor authentication for
# the next 5 minutes" on the npm website to let the rest through (npm's own advice for bulk use).
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
"${NPM[@]}" whoami > /dev/null || { echo "Sign in first: npm login" >&2; exit 1; }

for name in $packages; do
  echo "== $name"
  if "${NPM[@]}" view "$name" name > /dev/null 2>&1; then exists=true; else exists=false; fi
  trusted=$("${NPM[@]}" trust list "$name" --json 2>/dev/null || echo "[]")
  echo "   on npm: $exists; trusted publishers: $trusted"
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
  fi

  if [ "$trusted" = "[]" ] || [ -z "$trusted" ]; then
    "${NPM[@]}" trust github "$name" --repo "$REPO" --file "$WORKFLOW" --env "$ENVIRONMENT" --allow-publish --yes
    sleep 2
  else
    echo "   a trusted publisher exists; check it names $REPO, $WORKFLOW and $ENVIRONMENT"
  fi
  "${NPM[@]}" access set mfa=publish "$name"
  sleep 2
done

echo
echo "Done. Merge the version pull request within 2 days, before the configurations expire."
echo "On npmjs.com, each package's Settings should now show the trusted publisher and"
echo "\"Require two-factor authentication and disallow tokens\"."
