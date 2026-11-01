# TeamCity release

Project: `EyeAuras_GitFocus`. Verification job: `EyeAuras_GitFocus_Release`;
publication job: `EyeAuras_GitFocus_NpmRelease`.
Both manual jobs check out the public Git root `EyeAuras_GitFocus_Repo`
(`https://github.com/iXab3r/git-focus.git`, `refs/heads/main`) on a Linux agent
with Docker. Its command-line step uses `node:22-bookworm` and runs:

```sh
set -eu
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/git-focus-rustup.sh
  sh /tmp/git-focus-rustup.sh -y --profile minimal --default-toolchain stable
fi
node --version
npm --version
cargo --version
node scripts/release.mjs
```

No automatic publication trigger is configured. `env.RELEASE_MODE` defaults to
`dry-run`. The publication job has a **password** parameter `npm.token` and an
`env.NPM_TOKEN` reference to it, copied server-side from the existing CLI Factory
release job with explicit authorization. The token value stays protected;
never put it in a plain CLI parameter, command line, repository or log. Updating protected
parameters through teamcity-cli requires its `Credentials` permission; do not
change permissions merely to bypass a denied command.

Queue verification through the authenticated teamcity-cli profile:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_Release \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=dry-run
```

For publication after verification:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_NpmRelease \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=publish
```

Omit `--branch` to select the configured default `refs/heads/main`.
Commit the new package.json/package-lock.json version first.
The script rejects a different checkout SHA, and publication additionally
requires the current remote main. It runs clean-install, typecheck, bundle,
tests, committed-bundle comparison, pack and installed-bin smoke checks.
Only the packed tarball is published, with public access and the latest tag;
registry integrity must match. The tarball and revision/integrity evidence
are saved under `release-artifacts/` in the agent checkout.

After success independently query npm version, latest tag and integrity, and
install the registry package into a temporary prefix. Run
`node scripts/smoke.mjs <prefix>/node_modules/.bin/git-focus` against that
installation. A successful dry run does not prove publication.
