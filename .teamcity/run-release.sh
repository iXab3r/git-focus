#!/bin/sh
set -eu

# This is our generated receipt, not source or a build cache.
rm -f release-artifacts/evidence.json
publish_artifacts() {
  if [ -f release-artifacts/evidence.json ]; then
    printf '%s\n' "##teamcity[publishArtifacts 'release-artifacts => release']"
  fi
}
trap publish_artifacts EXIT

export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/git-focus-rustup.sh
  sh /tmp/git-focus-rustup.sh -y --profile minimal --default-toolchain stable
fi
npm install --global npm@11.21.1
node --version
npm --version
cargo --version
node scripts/release.mjs
