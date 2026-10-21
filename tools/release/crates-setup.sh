#!/bin/sh
# A crate's first release on crates.io, once (D143; VERIFIED_FACTS, WP-11): crates.io lets a
# crate's trusted publisher be configured only once the crate exists, so its first version is
# published with a token of yours. Every later release publishes through trusted publishing in
# .github/workflows/release.yml.
#
#   tools/release/crates-setup.sh <version>      e.g. tools/release/crates-setup.sh 0.2.0
#
# It publishes mostra-host at <version> from the release's own tag (v<version>), with the bundle
# pins the published @mostra/sdk of that version carries, after checking them against the GitHub
# release's SHA256SUMS. Then it shows how to configure the trusted publisher. Your token is read
# from the terminal, never echoed, never stored, and passed to cargo only.
set -eu

version=${1:-}
case "$version" in
  "" | *[!0-9A-Za-z.+-]*) echo "usage: tools/release/crates-setup.sh <version>" >&2; exit 2 ;;
esac
crate=mostra-host
repo=$(git rev-parse --show-toplevel)
agent="mostra-release (https://github.com/mostra-dev/mostra)"

if curl -fsS -A "$agent" -o /dev/null "https://crates.io/api/v1/crates/$crate" 2>/dev/null; then
  echo "$crate already exists on crates.io: its releases publish through trusted publishing." >&2
  echo "If its trusted publisher isn't configured yet, see the steps at the end of this script." >&2
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/crates-setup.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM

echo "→ the release's source (tag v$version)"
git -C "$repo" fetch --quiet --no-tags origin "+refs/tags/v$version:refs/tags/v$version"
git -C "$repo" archive "v$version" | tar -x -C "$work"

echo "→ the pins @mostra/sdk@$version carries"
(cd "$work" && npm pack --silent "@mostra/sdk@$version" >/dev/null)
tar -xzf "$work"/mostra-sdk-"$version".tgz -C "$work" package/dist/bundles.json
cp "$work/package/dist/bundles.json" "$work/crates/$crate/bundles.json"

echo "→ checking them against the GitHub release's SHA256SUMS"
curl -fsSL -A "$agent" -o "$work/SHA256SUMS" \
  "https://github.com/mostra-dev/mostra/releases/download/v$version/SHA256SUMS"
node -e '
  const fs = require("node:fs");
  const [pinsFile, sumsFile] = process.argv.slice(1);
  const pins = JSON.parse(fs.readFileSync(pinsFile, "utf8"));
  const sums = new Map(fs.readFileSync(sumsFile, "utf8").trim().split("\n")
    .map((line) => line.trim().split(/\s+\*?/)).map(([sum, file]) => [file, sum]));
  const assets = Object.values(pins.assets);
  if (assets.length === 0) throw new Error("the pins name no bundle");
  for (const asset of assets) {
    if (sums.get(asset.file) !== asset.sha256) throw new Error(`${asset.file} differs from SHA256SUMS`);
  }
  console.log(`  ${assets.length} bundles match`);
' "$work/crates/$crate/bundles.json" "$work/SHA256SUMS"

echo "→ packaging $crate $version"
(cd "$work" && cargo package --quiet --allow-dirty -p "$crate")

printf "crates.io API token (Account Settings → API Tokens; scope publish-new, crate %s): " "$crate"
stty -echo 2>/dev/null || true
read -r token
stty echo 2>/dev/null || true
echo
[ -n "$token" ] || { echo "No token given; nothing published." >&2; exit 1; }

echo "→ publishing $crate $version"
(cd "$work" && CARGO_REGISTRY_TOKEN=$token cargo publish --allow-dirty -p "$crate")
token=

cat <<EOF

$crate $version is on crates.io. Two last steps, once:
  1. https://crates.io/crates/$crate/settings → Trusted Publishing → Add:
       GitHub repository owner: mostra-dev    repository: mostra
       workflow filename: release.yml         environment: release
  2. Revoke the token you just used (Account Settings → API Tokens).
From the next release on, .github/workflows/release.yml publishes $crate itself.
EOF
