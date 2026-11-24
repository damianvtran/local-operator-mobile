# The store uploader, and nothing else. This Gemfile exists so the version of
# fastlane a release runs is a line in this repository, resolved by a committed
# Gemfile.lock, rather than whatever a runner image happens to ship.
#
# WHY NOT THE RUNNER IMAGE'S FASTLANE. Until tag v0.1.0 the workflows ran the
# image's preinstalled `fastlane`. `ubuntu-latest` then moved to ubuntu-26.04,
# which ships no fastlane at all, and the first tagged release failed at its
# TestFlight step with `fastlane: command not found` — after the GitHub Release
# had been created (run 45128303563). An image label is not a pin for a tool the
# image owners can drop.
#
# HOW IT IS USED. `.github/actions/setup-fastlane` installs Ruby and runs
# `bundle install` against Gemfile.lock (frozen, cached); every lane runs as
# `bundle exec fastlane ...`. Upgrading fastlane is a change to the version
# below plus a regenerated lock that names both CI platforms:
#   bundle lock --update fastlane --add-platform x86_64-linux arm64-darwin
source "https://rubygems.org"

gem "fastlane", "2.242.0"
