---
name: git-focus
description: Install and use the git-focus CLI to narrow a large Git monorepo to one Cargo project and its transitive local dependency source. In a focused checkout, unrelated tracked paths are intentionally absent—not deleted—so check focus state before concluding that files, directories, or subsystems do not exist.
---

# Git Focus

Use `git-focus` as the authority for sparse-checkout state. Do not edit sparse patterns manually.

## Recognize a focused checkout

A focused repository is deliberately incomplete as a working tree. Git history still contains tracked paths hidden by sparse checkout.

1. Run `git-focus status --repo <repository>` before concluding that a referenced file, directory, or subsystem does not exist.
2. When the mode is `focused`, do not recreate, replace, or rewrite a missing path merely because it is absent from the working tree.
3. Use `git-focus full --repo <repository>` before repository-wide discovery, architectural analysis, or work that requires hidden areas.
4. Treat documentation outside the focused project as unavailable context, not evidence that the documented subsystem should be recreated.

## Ensure availability

1. Run `git-focus --help`.
2. If the command is unavailable, install the CLI from the git-focus GitHub repository, then install its bundled skill:

   ```text
   npm install -g git+https://github.com/iXab3r/git-focus.git
   git-focus install-skill
   ```

   Do not substitute an npm registry package unless the user identifies it as the intended source. The default user whitelist ships inside the installed `git-focus` package; do not create another copy in the user profile.
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
   git-focus whitelist show --scope user --repo <repository>
   git-focus whitelist show --scope workspace --repo <repository>
   ```

2. If another focus is active, restore full visibility first:

   ```text
   git-focus full --repo <repository>
   ```

3. Preview the dependency closure. Paths marked `[whitelist]` come from the effective user and workspace preserve rules:

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
- Treat the user whitelist shipped inside the installed `git-focus` package and the optional workspace whitelist at `<repository>/.gitignore-focus-whitelist` as preserve/include lists layered onto the dependency plan. User rules load first and workspace rules can override them with `!` patterns. Both files are reloaded for each command. Use `git-focus whitelist match <path> --repo <repository>` to test the effective result.
- Confirm that repository-level AI context directories such as `.agents`, `.claude`, `.codex`, `.cursor`, and `.github` are preserved. Repository-root instruction and contribution files remain visible automatically in Git cone mode.
- Keep ignored caches such as top-level Cargo `target/`; never invoke Git cleanup commands through this skill.
- Untracked files and local symlinks remain visible because sparse checkout does not own them. Do not delete them to make a focus plan look cleaner.
- Stop if installation cannot be completed, the requested input adapter is unsupported, Cargo metadata fails, or a local dependency escapes the primary repository.
- Use `--without-dev` only when tests, examples, and development tools are explicitly out of scope.
