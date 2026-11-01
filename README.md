# git-focus

Hide irrelevant module blocks from AI coding agents in large monorepos.

- **Module blocks:** `exclude` large module trees, then `include` only the parts relevant to the AI task.
- **Cargo projects:** keep a Rust project and its transitive local dependencies.
- **Preview:** `--dry-run` for paths, `plan` for Cargo projects.
- **Preserve rules:** keep shared source and AI context with `.gitignore-focus-whitelist`.
- **Safe changes:** reject dirty worktrees unless `--force` is explicit; retain ignored build caches.
- **Worktree-local state:** focus linked worktrees independently.
- **Reversible:** `full` restores tracked source; Git history stays intact.

![Hide a module tree and expose only the player and combat modules for an AI task](docs/assets/sparse-checkout-focus.svg)

## Install

Node.js 20+; Cargo is needed only for Rust project focus.

```sh
npm install -g git-focus
git-focus install-skill
```

## Use

Run from your repository, or add `--repo /path/to/repo`.

```sh
git-focus exclude modules/ --dry-run
git-focus exclude modules/
git-focus include modules/player/ modules/combat/
git-focus status
git-focus full

git-focus plan api/Cargo.toml
git-focus api/Cargo.toml
git-focus full
```

Paths are exact names, not globs. Restore `full` before switching between path and Cargo focus.

More: `git-focus --help` · [Agent Skill](.agents/skills/git-focus/SKILL.md) · [Release workflow](.teamcity/README.md)
