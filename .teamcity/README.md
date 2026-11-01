# TeamCity release of git-focus

The public npm name is **git-focus**, without a scope. Project:
`EyeAuras_GitFocus`. Verification job: `EyeAuras_GitFocus_Release`;
staging job: `EyeAuras_GitFocus_NpmRelease`. Both check out the public Git root
`EyeAuras_GitFocus_Repo` (`https://github.com/iXab3r/git-focus.git`,
`refs/heads/main`). No automatic publication trigger is configured.

The Linux Docker runner uses `node:22-bookworm` (at least Node 22.14.0),
npm **11.21.1**, and Cargo. The versioned runner installs npm inside the job
container, not globally on the workstation. Its TeamCity command-line step is:

```sh
sh .teamcity/run-release.sh
```

## Credential and first registration

The staging job uses a **password** parameter `npm.token` and the plain reference
`env.NPM_TOKEN=%npm.token%`. Never store the token value in a plain parameter,
command line, repository or log. Updating protected parameters through
teamcity-cli requires its `Credentials` permission and explicit authorization.
Restore the previous CLI permission after the authorized operation.

Create a dedicated npm granular token with package access **Read and write
(stage only)** and **Bypass 2FA disabled**. Organization-management access is
not needed. A token limited to `@eyeauras` or other existing packages does not
cover the new unscoped name `git-focus`.

For the first registration, the credential must permit creation of this name.
Before the package exists it may not be selectable in the token UI. If npm
requires a broader bootstrap grant such as All Packages, obtain the owner's
explicit authorization, use a short-lived bootstrap credential, and replace it
with a token restricted to `git-focus` as soon as the staged placeholder exists.
Do not silently widen an existing token or disable account/package 2FA.

The previously copied CLI Factory credential received E403 on direct publish;
its suitability for staging or creating this package has not been established.
A stored secret is not proof of effective npm authorization.

## Build, stage, approve, verify

Commit the new package.json/package-lock.json version first. Every mode requires
`env.RELEASE_REVISION` to equal the checkout SHA and starts with a clean checkout.
Stage additionally requires that SHA to equal current remote main. Omit
`--branch` to select the configured default `refs/heads/main`.

Verify the tested package without uploading anything:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_Release \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=dry-run
```

Upload the exact tested tarball for human approval:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_NpmRelease \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=stage
```

All modes run clean-install, typecheck, bundle, tests, committed-bundle comparison,
pack and installed-bin smoke checks. Stage records the returned stage ID, then
downloads the staged tarball and compares SHA-512 integrity with the tested file.
Its successful result is **awaiting-2fa-approval**, not published. If later
verification fails, the receipt retains **staged-unverified** and the stage ID;
inspect that stage instead of re-staging the same version blindly.

On npmjs.com, open **Staged Packages**, inspect `git-focus@<version>`, and approve
with 2FA. First staging creates a public `0.0.0-stage` placeholder; that placeholder
is not the requested release. Never approve a stage whose integrity failed.

After approval, independently verify public registry publication:

```sh
teamcity-cli jobs run EyeAuras_GitFocus_Release \
  --param env.RELEASE_REVISION=<full-main-SHA> --param env.RELEASE_MODE=verify
```

Verify requires matching registry integrity and `latest`, installs that exact
version from npm into a temporary prefix, checks its lockfile integrity and runs
exclude/include/dry-run/status/full/dirty-gate/cache smoke checks through the
installed bin. Only this result is **published-verified**. A missing version,
placeholder, wrong tag or different tarball fails verification. Run this before
main advances to another revision, since the default checkout must match the
release SHA.

The packed tarball and revision/integrity/status receipt are TeamCity artifacts
under `release/`. A failed attempt must not reuse a previous receipt.

References: [staged publishing](https://docs.npmjs.com/staged-publishing/),
[granular tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
