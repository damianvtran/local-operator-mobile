#!/usr/bin/env bash
# Provision the pinned Maestro CLI from its GitHub release, with retries and an
# integrity check, into $MAESTRO_DIR (default ~/.maestro).
#
# WHY THIS REPLACES `curl -fsSL https://get.maestro.mobile.dev | bash`:
# the upstream installer downloads the release zip with a single, non-retrying
# `curl --fail`, so one transient 504 from GitHub's release CDN failed the whole
# native lane before the app was ever launched (e2e.yml run 42581162973, also
# 42573553980 and 42571245938: `curl: (56) The requested URL returned error:
# 504`, then "Downloaded zip archive is corrupt"). The installer also exits 0
# on that path (a bare `exit` after an echo), so without an extra check the
# failure only surfaces at the first `maestro` call. This script fetches the very same asset the installer uses for
# a pinned version
#   https://github.com/mobile-dev-inc/maestro/releases/download/cli-$MAESTRO_VERSION/maestro.zip
# but retries transient errors, verifies the archive and its sha256, and fails
# closed. ADR 0004's "pinned Maestro installer" exception still describes it:
# the version pin is unchanged, only the transport got sturdier.
#
# Usage: MAESTRO_VERSION=2.11.0 scripts/ci/install-maestro.sh
#   MAESTRO_ZIP_CACHE  directory holding the downloaded zip between runs (the
#                      composite action .github/actions/install-maestro points
#                      actions/cache at it); default $RUNNER_TEMP or $TMPDIR.
#   MAESTRO_DIR        install root; bin/ and lib/ land here (default ~/.maestro).
#   GITHUB_PATH        when set (on Actions), $MAESTRO_DIR/bin is appended to it.
set -euo pipefail

: "${MAESTRO_VERSION:?MAESTRO_VERSION must pin the Maestro CLI version}"
MAESTRO_DIR="${MAESTRO_DIR:-$HOME/.maestro}"
cache_dir="${MAESTRO_ZIP_CACHE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/maestro-dist}/$MAESTRO_VERSION"
release_url="https://github.com/mobile-dev-inc/maestro/releases/download/cli-$MAESTRO_VERSION"
zip="$cache_dir/maestro.zip"

# Expected digests pinned in the repository, so a swapped release asset cannot
# pass by also swapping the release's own checksums file. A version missing
# here falls back to the release's published checksums_sha256.txt (Maestro
# ships one per release) — add the digest when bumping MAESTRO_VERSION.
pinned_sha256() {
  case "$1" in
    2.11.0) echo 5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a ;;
    *) echo "" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# --retry-all-errors makes curl retry the HTTP 5xx the CDN returned (plain
# --retry treats a 504 mid-body as fatal); --fail keeps an error page from
# being written as the archive.
fetch() {
  curl --fail --location --silent --show-error \
    --retry 5 --retry-all-errors --retry-delay 10 --connect-timeout 20 \
    --output "$2" "$1"
}

expected="$(pinned_sha256 "$MAESTRO_VERSION")"
if [ -z "$expected" ]; then
  sums="$(mktemp)"
  fetch "$release_url/checksums_sha256.txt" "$sums"
  expected="$(awk '$2 == "maestro.zip" { print $1 }' "$sums")"
  rm -f "$sums"
  [ -n "$expected" ] || { echo "::error::no maestro.zip digest in cli-$MAESTRO_VERSION checksums_sha256.txt"; exit 1; }
  echo "Using the release-published sha256 for Maestro $MAESTRO_VERSION (not pinned in this script)."
fi

mkdir -p "$cache_dir"
if [ -f "$zip" ] && [ "$(sha256_of "$zip")" = "$expected" ]; then
  echo "Reusing cached Maestro $MAESTRO_VERSION archive."
else
  rm -f "$zip"
  echo "Downloading $release_url/maestro.zip"
  fetch "$release_url/maestro.zip" "$zip.part"
  mv "$zip.part" "$zip"
fi

actual="$(sha256_of "$zip")"
echo "maestro.zip sha256: $actual (expected $expected)"
if [ "$actual" != "$expected" ]; then
  rm -f "$zip"
  echo "::error::Maestro $MAESTRO_VERSION archive sha256 mismatch"
  exit 1
fi
unzip -tq "$zip"

# Same layout the upstream installer produces: the archive's maestro/ folder
# is copied over $MAESTRO_DIR, giving $MAESTRO_DIR/bin/maestro.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
unzip -qo "$zip" -d "$staging"
mkdir -p "$MAESTRO_DIR"
rm -rf "${MAESTRO_DIR:?}/bin" "${MAESTRO_DIR:?}/lib"
cp -R "$staging"/maestro/. "$MAESTRO_DIR"/
test -x "$MAESTRO_DIR/bin/maestro"
echo "Installed Maestro $MAESTRO_VERSION into $MAESTRO_DIR"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$MAESTRO_DIR/bin" >> "$GITHUB_PATH"
fi
