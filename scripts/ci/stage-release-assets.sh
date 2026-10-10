#!/usr/bin/env bash
#
# Stage the downloaded release artefacts under the names a person downloads, and
# say which files those are.
#
# WHY THIS IS A SCRIPT AND NOT THREE LINES IN release.yml: the shapes it depends on
# are the ones `actions/upload-artifact` chooses, and those are not obvious — with
# several `path:` entries the artefact root is their least common ancestor, so the
# layout `artifacts/` receives is decided in the BUILD jobs, not here (review round
# 3, B1). `ci.yml`'s `release-staging` job performs a real upload/download round
# trip and calls THIS script, so a change to either half is caught by a job that
# needs no credentials rather than by the first tagged release.
#
# Usage:
#   scripts/ci/stage-release-assets.sh <artifacts-dir> <version> [platforms]
#   scripts/ci/stage-release-assets.sh --list <artifacts-dir> <version> <platforms>
#
# `platforms` is the comma-separated list release.yml resolved from
# `RELEASE_PLATFORMS`. A disabled platform's artefact was never downloaded, so
# staging it would fail on a file that is correctly absent; an ENABLED platform's
# artefact missing is still a hard error.
#
# * OMITTED (argument not given) means every platform — what the `release-staging`
#   probe in ci.yml exercises.
# * GIVEN BUT EMPTY is an error, never "everything": an unresolved platform list
#   must stop a release, not widen it to a platform nobody enabled.
#
# `--list` prints the published file path of each enabled platform's assets, one
# per line, and touches nothing. It exists so the platform → file-name mapping is
# written ONCE (`assets_for`, below): the staging renames and the `gh release
# create` asset list both come from it, and cannot drift apart.
#
# `set -euo pipefail` because every step here is a rename that must not fail
# quietly: a missing input would otherwise leave the store steps with nothing to
# upload and a GitHub Release missing a file.
set -euo pipefail

list_only=0
if [ "${1:-}" = "--list" ]; then
  list_only=1
  shift
fi

usage="usage: stage-release-assets.sh [--list] <artifacts-dir> <version> [platforms]"
dir="${1:?$usage}"
version="${2:?$usage}"
platforms="${3-ios,android}"

# The published names, per platform. The product is "Local Operator"; the
# repository and the bundle id are internal identifiers and stay as they are. So do
# the file names a person downloads: `app-release.apk` tells a reader nothing about
# which app or which version it is.
assets_for() {
  case "$1" in
    android) echo "local-operator-${version}.apk"; echo "local-operator-${version}.aab" ;;
    ios) echo "local-operator-${version}.ipa" ;;
  esac
}

android=0
ios=0
case ",${platforms}," in *,android,*) android=1 ;; esac
case ",${platforms}," in *,ios,*) ios=1 ;; esac
if [ "$android" = 0 ] && [ "$ios" = 0 ]; then
  # stderr, not stdout: in `--list` mode stdout IS the asset list, and an error
  # line there would be attached to the Release as if it were a file name.
  echo "::error::no recognised platform in '$platforms' (expected ios and/or android)" >&2
  exit 1
fi

if [ "$list_only" = 1 ]; then
  if [ "$android" = 1 ]; then assets_for android | sed "s|^|$dir/|"; fi
  if [ "$ios" = 1 ]; then assets_for ios | sed "s|^|$dir/|"; fi
  exit 0
fi

if [ "$android" = 1 ]; then
  mv "$dir/app-release.aab" "$dir/local-operator-${version}.aab"
  mv "$dir/app-release.apk" "$dir/local-operator-${version}.apk"
fi
if [ "$ios" = 1 ]; then
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
fi

# Every enabled platform's published files must now exist and be non-empty.
{
  if [ "$android" = 1 ]; then assets_for android; fi
  if [ "$ios" = 1 ]; then assets_for ios; fi
} | while IFS= read -r asset; do
  test -s "$dir/$asset" || {
    echo "::error::$dir/$asset is missing after staging"
    exit 1
  }
done

ls -l "$dir"
