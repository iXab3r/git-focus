---
name: git-focus
description: Narrow a large Git monorepo to one project and its transitive local dependency source using the git-focus CLI. Use before exploring, searching, editing, or testing a repository where unrelated projects would pollute agent context; use it to switch between focused and full source visibility while retaining ignored build caches. Supports Cargo inputs now and additional project-system adapters later.
---

# Git Focus

Use `git-focus` as the authority for sparse-checkout state. Do not edit sparse patterns manually.

## Focus a task

1. Check the current state:

   ```text
   git-focus status --repo <repository>
   ```

2. If another focus is active, restore full visibility first:

   ```text
   git-focus full --repo <repository>
   ```

3. Preview the dependency closure:

   ```text
   git-focus plan <path/to/Cargo.toml>
   ```

4. Confirm that the plan contains the target and expected local dependencies, then apply it:

   ```text
   git-focus <path/to/Cargo.toml>
   ```

5. A dirty repository must fail before sparse checkout begins. Report the changed paths and stop. Use `--force` only when the user explicitly authorizes overriding this fail-safe:

   ```text
   git-focus <path/to/Cargo.toml> --force
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
- Keep ignored caches such as top-level Cargo `target/`; never invoke Git cleanup commands through this skill.
- Untracked files and local symlinks remain visible because sparse checkout does not own them. Do not delete them to make a focus plan look cleaner.
- Stop if `git-focus` is unavailable, the requested input adapter is unsupported, Cargo metadata fails, or a local dependency escapes the primary repository.
- Use `--without-dev` only when tests, examples, and development tools are explicitly out of scope.
