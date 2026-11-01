# TeamCity release

Project: `EyeAuras_GitFocus`, job: `EyeAuras_GitFocus_Release`.
The manual job checks out the public Git root `EyeAuras_GitFocus_Repo`
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
`dry-run`. Configure a **password** parameter `env.NPM_TOKEN` restricted to
publishing the npm package `git-focus` before a real release. Never put its value
in a plain CLI parameter, command line, repository or log. Updating protected
parameters through teamcity-cli requires its `Credentials` permission; do not
change permissions merely to bypass a denied command.

Queue verification through the authenticated teamcity-cli profile:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_Release --branch main \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=dry-run
```

For publication use the same command with `env.RELEASE_MODE=publish` after
verification. Commit the new package.json/package-lock.json version first.
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
