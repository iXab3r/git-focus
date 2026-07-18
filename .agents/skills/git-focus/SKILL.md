---
name: git-focus
description: Install and use the git-focus CLI to narrow a large Git monorepo to one Cargo project and its transitive local dependency source. Use when a user asks to use git-focus, when unrelated projects would pollute agent context, or when switching between focused and full source visibility while retaining ignored build caches.
---

# Git Focus

Use `git-focus` as the authority for sparse-checkout state. Do not edit sparse patterns manually.

## Ensure availability

1. Run `git-focus --help`.
2. If the command is unavailable, install the CLI from the git-focus GitHub repository, then install its bundled skill:

   ```text
   npm install -g git+https://github.com/iXab3r/git-focus.git
   git-focus install-skill
   ```

   Do not substitute an npm registry package unless the user identifies it as the intended source.
3. If the CLI works but the user skill is missing or stale, install or refresh it with:

   ```text
   git-focus install-skill
   ```

4. If a newly installed skill is not visible to the agent host, start a new task or restart the host. If the repository path is unknown or installation fails, report the exact blocker and stop.

## Focus a task

1. Check the current state and repository preserve rules:

   ```text
   git-focus status --repo <repository>
   git-focus whitelist show --repo <repository>
   ```

2. If another focus is active, restore full visibility first:

   ```text
   git-focus full --repo <repository>
   ```

3. Preview the dependency closure. Paths marked `[whitelist]` come from the repository-root `.gitignore-focus-whitelist` preserve list:

   ```text
   git-focus plan <path/to/Cargo.toml> --repo <repository>
   ```

4. Confirm that the plan contains the target and expected local dependencies, then apply it:

   ```text
   git-focus <path/to/Cargo.toml> --repo <repository>
   ```

5. A dirty repository must fail before sparse checkout begins. Report the changed paths and stop. Use `--force` only when the user explicitly authorizes overriding this fail-safe:

   ```text
   git-focus <path/to/Cargo.toml> --repo <repository> --force
   ```

   Never stash, commit, clean, or force-deinitialize a submodule merely to make focus succeed.

## Verify work

Run project-scoped checks while focused. Before a repository-wide acceptance gate:

```text
git-focus full --repo <repository>
```

Run the full gate, then reapply the prior project focus only if more scoped work remains. Expect sparse expansion to refresh source mtimes and cause some build-system fingerprint work; retained ignored caches still materially reduce rebuild cost.

## Safety

- Treat the printed project and repository plan as the scope receipt.
- Treat `.gitignore-focus-whitelist` as a preserve/include list layered onto the dependency plan. It uses `.gitignore` syntax and is reloaded for each command. Use `git-focus whitelist match <path> --repo <repository>` to test uncertain paths.
- Confirm that repository-level AI context directories such as `.agents`, `.claude`, `.codex`, `.cursor`, and `.github`, plus repository-wide `docs`, `tools`, and `scripts`, are preserved. Repository-root instruction and contribution files remain visible automatically in Git cone mode.
- Keep ignored caches such as top-level Cargo `target/`; never invoke Git cleanup commands through this skill.
- Untracked files and local symlinks remain visible because sparse checkout does not own them. Do not delete them to make a focus plan look cleaner.
- Stop if installation cannot be completed, the requested input adapter is unsupported, Cargo metadata fails, or a local dependency escapes the primary repository.
- Use `--without-dev` only when tests, examples, and development tools are explicitly out of scope.
