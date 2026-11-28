#!/usr/bin/env bash
# Obtain the EXACT capture renderer pinned in capture-chrome.pin and unpack it.
#
# WHY. The design-kit job's gate re-renders the committed listing frames and
# compares them with the files in the tree. The job used to copy whatever Google
# Chrome the runner image shipped (/Applications/Google Chrome.app), so the gate's
# verdict depended on the image: the macos-26 pool is MIXED, image
# 20261117.0516.1 shipped Chrome 157.0.8103.79 (21/21 jobs passed with the
# committed frames) and image 20261123.0526.1 shipped 158.0.8127.37 (4/4 failed,
# +4..+19 px at 30/255 on the caption SVG mark's stroke edge). Freezing a COPY only
# kept Chrome constant within one job. Regenerating the frames with 158 would just
# flip which image fails, so the renderer is pinned by version AND checksum
# instead, from Chrome for Testing (versioned, immutable downloads).
#
# FAILS CLOSED. A download that does not match the committed sha256, an archive
# that does not unpack to the expected binary, or a binary that does not report
# the pinned version all exit 1. There is deliberately NO fallback to the image's
# Chrome: a fallback is exactly the image dependence this removes.
#
# Usage: fetch-capture-chrome.sh <pin-file> <destination-dir>
# Prints the path of the pinned binary (and nothing else) on stdout; every log
# line goes to stderr. Needs macOS tools only (curl, shasum, ditto): it runs
# before the job's setup-node step.
#
# CAPTURE_CHROME_DOWNLOAD_BASE overrides the download host (default: Google's
# Chrome for Testing bucket). It exists so the tests can serve a fixture archive
# through file://; CI never sets it.
set -euo pipefail

pin_file="${1:?usage: fetch-capture-chrome.sh <pin-file> <destination-dir>}"
dest="${2:?usage: fetch-capture-chrome.sh <pin-file> <destination-dir>}"
base="${CAPTURE_CHROME_DOWNLOAD_BASE:-https://storage.googleapis.com/chrome-for-testing-public}"

fail() { echo "::error::capture renderer pin: $*" >&2; exit 1; }

[ -f "$pin_file" ] || fail "no pin file at $pin_file"
# Parse strictly: exactly one version= and one sha256= line, shapes validated,
# so a typo or a stray edit cannot silently weaken the check (an empty sha256
# must never compare equal to anything).
version="$(sed -n 's/^version=//p' "$pin_file")"
sha256="$(sed -n 's/^sha256=//p' "$pin_file")"
[ "$(grep -c '^version=' "$pin_file")" = 1 ] && [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "$pin_file needs exactly one version=<major.minor.build.patch> line (got '$version')"
[ "$(grep -c '^sha256=' "$pin_file")" = 1 ] && [[ "$sha256" =~ ^[0-9a-f]{64}$ ]] \
  || fail "$pin_file needs exactly one sha256=<64 lowercase hex> line (got '$sha256')"

archive="$dest.zip"
url="$base/$version/mac-arm64/chrome-mac-arm64.zip"
rm -rf "$dest" "$archive"
echo "downloading Chrome for Testing $version: $url" >&2
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 20 --max-time 600 -o "$archive" "$url" \
  || fail "could not download $url"

actual="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
if [ "$actual" != "$sha256" ]; then
  rm -f "$archive"
  fail "sha256 mismatch for $url: pinned $sha256, downloaded $actual; refusing to use it (no fallback to the runner's Chrome)"
fi
echo "sha256 verified: $actual" >&2

mkdir -p "$dest"
ditto -x -k "$archive" "$dest" || fail "could not unpack the verified archive"
rm -f "$archive"

# The CfT bundle and executable are named differently from branded Chrome.
binary="$dest/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
[ -x "$binary" ] || fail "the archive has no executable at ${binary#"$dest"/}"
reported="$("$binary" --version 2>&1 | head -1)" || fail "the unpacked renderer does not run: $reported"
version_re='([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)'
reported_version=""
[[ "$reported" =~ $version_re ]] && reported_version="${BASH_REMATCH[1]}"
[ "$reported_version" = "$version" ] \
  || fail "the unpacked renderer reports '$reported', not the pinned $version"
echo "pinned capture renderer ready: $reported" >&2
printf '%s\n' "$binary"
