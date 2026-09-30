#!/usr/bin/env bash
#
# Stage the downloaded release artefacts under the names a person downloads.
#
# WHY THIS IS A SCRIPT AND NOT THREE LINES IN release.yml: the shapes it depends on
# are the ones `actions/upload-artifact` chooses, and those are not obvious — with
# several `path:` entries the artefact root is their least common ancestor, so the
# layout `artifacts/` receives is decided in the BUILD jobs, not here (review round
# 3, B1). `ci.yml`'s `release-staging` job performs a real upload/download round
# trip and calls THIS script, so a change to either half is caught by a job that
# needs no credentials rather than by the first tagged release.
#
# Usage: scripts/ci/stage-release-assets.sh <artifacts-dir> <version>
#
# `set -euo pipefail` because every step here is a rename that must not fail
# quietly: a missing input would otherwise leave the store steps with nothing to
# upload and a GitHub Release missing a file.
set -euo pipefail

dir="${1:?usage: stage-release-assets.sh <artifacts-dir> <version>}"
version="${2:?usage: stage-release-assets.sh <artifacts-dir> <version>}"

# The product is "Local Operator"; the repository and the bundle id are internal
# identifiers and stay as they are. So do the file names a person downloads:
# `app-release.apk` tells a reader nothing about which app or which version it is.
mv "$dir/app-release.aab" "$dir/local-operator-${version}.aab"
mv "$dir/app-release.apk" "$dir/local-operator-${version}.apk"
# `nullglob` so a missing IPA is an empty list rather than the literal pattern
# `...*.ipa`, which would then be renamed to (and tested as) a file that cannot
# exist — the difference between "the glob found nothing" and "the glob found a
# file called *.ipa" is the whole value of this assertion.
shopt -s nullglob
ipas=("$dir"/*.ipa)
if [ "${#ipas[@]}" -ne 1 ]; then
  echo "::error::$dir holds ${#ipas[@]} .ipa files, expected exactly one"
  exit 1
fi
mv "${ipas[0]}" "$dir/local-operator-${version}.ipa"

for asset in aab apk ipa; do
  test -s "$dir/local-operator-${version}.${asset}" || {
    echo "::error::$dir/local-operator-${version}.${asset} is missing after staging"
    exit 1
  }
done

ls -l "$dir"
