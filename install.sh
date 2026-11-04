#!/bin/bash
# Installs Kitab into /Applications from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/plusminushalf/kitaab/main/install.sh | bash
#
# Set KITAB_VERSION=0.1.0 to install a specific release instead of the latest.
#
# Before installing, it checks that SHA256SUMS was signed by Kitab's release key
# (pinned below, also in release-key.pub) and that the DMG matches the signed hash.
# Anything that doesn't verify is refused.
#
# Files fetched with curl aren't quarantined by macOS, so the ad-hoc-signed app
# opens without a Gatekeeper prompt. That is why the signature check here matters.
set -euo pipefail

REPO="plusminushalf/kitaab"
PRINCIPAL="kitab-release"
PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIKSxxZ9QRwqldlKJi68n/FSXG32Hpy8JCzYGIDVPSGo"
APP="/Applications/Kitab.app"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Global, not local to main: the EXIT trap runs after main has returned.
tmp=""
mnt=""
cleanup() {
  if [ -n "$mnt" ]; then hdiutil detach -quiet "$mnt" 2>/dev/null || true; fi
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
}

# Everything runs inside main, so a download cut off halfway through runs nothing.
main() {
  [ "$(uname -s)" = "Darwin" ] || die "Kitab runs on macOS only."
  # hw.optional.arm64 is 1 on Apple silicon, even in a shell running under Rosetta.
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] || die "Kitab builds are for Apple silicon Macs only."

  local base
  if [ -n "${KITAB_VERSION:-}" ]; then
    base="https://github.com/$REPO/releases/download/v${KITAB_VERSION#v}"
  else
    base="https://github.com/$REPO/releases/latest/download"
  fi

  tmp="$(mktemp -d)"
  trap cleanup EXIT

  say "Downloading the signed checksums"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "Couldn't download SHA256SUMS from $base"
  curl -fsSL "$base/SHA256SUMS.sig" -o "$tmp/SHA256SUMS.sig" || die "Couldn't download SHA256SUMS.sig from $base"

  say "Checking the release signature"
  echo "$PRINCIPAL $PUBLIC_KEY" > "$tmp/allowed_signers"
  ssh-keygen -Y verify -f "$tmp/allowed_signers" -I "$PRINCIPAL" -n "$PRINCIPAL" \
    -s "$tmp/SHA256SUMS.sig" < "$tmp/SHA256SUMS" > /dev/null 2>&1 \
    || die "SHA256SUMS is not signed by Kitab's release key. Not installing."

  local dmg expected actual
  dmg="$(awk '$2 ~ /^Kitab-.*-arm64\.dmg$/ { print $2; exit }' "$tmp/SHA256SUMS")"
  [ -n "$dmg" ] || die "This release has no Apple silicon DMG."
  expected="$(awk -v f="$dmg" '$2 == f { print $1; exit }' "$tmp/SHA256SUMS")"

  say "Downloading $dmg"
  curl -fL --progress-bar "$base/$dmg" -o "$tmp/$dmg" || die "Couldn't download $dmg"

  actual="$(shasum -a 256 "$tmp/$dmg" | awk '{ print $1 }')"
  [ "$actual" = "$expected" ] || die "$dmg doesn't match its signed SHA-256 (expected $expected, got $actual). Not installing."
  say "Verified: sha256 $actual"

  mnt="$tmp/mnt"
  mkdir "$mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$tmp/$dmg"
  [ -d "$mnt/Kitab.app" ] || die "The DMG doesn't contain Kitab.app."

  # Quit a running copy so it can be replaced.
  osascript -e 'if application id "app.kitab.desktop" is running then tell application id "app.kitab.desktop" to quit' > /dev/null 2>&1 || true

  say "Installing to $APP"
  local sudo=""
  [ -w /Applications ] || sudo="sudo"
  $sudo rm -rf "$APP"
  $sudo ditto "$mnt/Kitab.app" "$APP"

  hdiutil detach -quiet "$mnt"
  mnt=""

  say "Kitab is installed. Opening it."
  open "$APP"
}

main "$@"
