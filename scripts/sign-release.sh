#!/bin/bash
# Writes dist/SHA256SUMS for every DMG in dist/ and signs it with Kitaab's release
# key, producing dist/SHA256SUMS.sig. install.sh, and anyone checking a download
# by hand, verifies that signature against release-key.pub.
#
# The private key comes from $RELEASE_SIGNING_KEY (the key file's contents), which
# CI reads from the repository secret of the same name.
set -euo pipefail

cd "$(dirname "$0")/../dist"
[ -n "${RELEASE_SIGNING_KEY:-}" ] || { echo "RELEASE_SIGNING_KEY is not set" >&2; exit 1; }
ls Kitaab-*.dmg > /dev/null 2>&1 || { echo "No DMG in dist/; run pnpm dmg first" >&2; exit 1; }

shasum -a 256 Kitaab-*.dmg > SHA256SUMS

key="$(mktemp)"
trap 'rm -f "$key"' EXIT
printf '%s\n' "$RELEASE_SIGNING_KEY" > "$key"
rm -f SHA256SUMS.sig
ssh-keygen -q -Y sign -f "$key" -n kitab-release SHA256SUMS

# Check the signature before publishing it.
echo "kitab-release $(cat ../release-key.pub)" > "$key.allowed"
ssh-keygen -Y verify -f "$key.allowed" -I kitab-release -n kitab-release -s SHA256SUMS.sig < SHA256SUMS
rm -f "$key.allowed"

cat SHA256SUMS
