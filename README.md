# git-focus

`git-focus` is a dependency-aware sparse-checkout controller for large Git repositories. It keeps build caches and Git history intact while reducing the source files exposed to editors, search tools, and coding agents.

The executable is also a Git extension, so `git-focus ...` and `git focus ...` are equivalent when it is on `PATH`.

## Install

```text
npm i -g git-focus
```

From a local clone:

```text
npm install -g <path-to-git-focus-repository>
```

The global installation adds the CLI to `PATH` and installs the bundled Agent Skill under `$HOME/.agents/skills/git-focus`. Run `git-focus install-skill` to repair or refresh the skill manually. Start a new agent task or restart the agent host if it does not notice the new skill immediately.

Set `GIT_FOCUS_SKIP_SKILL_INSTALL=1` to install only the CLI. Requires Node.js 20+.

## Commands

```text
git-focus path/to/Cargo.toml
git-focus path/to/Cargo.toml --force
git-focus plan path/to/Cargo.toml
git-focus status --repo path/to/repository
git-focus full --repo path/to/repository
```
git-focus install-skill

The default command resolves the input project, computes its transitive local dependency closure, and requires every repository in the plan to have a clean working tree before it runs any sparse-checkout command. This includes staged, modified, and untracked files. Pass `--force` to bypass that fail-safe explicitly.

Focus applies cone-mode sparse checkout recursively to the repository containing the current directory and any nested repositories. Use `--repo` to choose a different explicit repository boundary. When forced, untracked files, local symlinks, and ignored build caches remain in place.

`full` restores every repository recorded by the last focus operation. It does not fetch, pull, update submodule commits, or clean ignored files such as `target/`.

## Input adapters

Framework discovery is isolated behind project input resolvers. The initial Cargo adapter uses `cargo metadata`; a future MSBuild adapter can produce the same framework-neutral graph without changing Git application or CLI orchestration.

## Development

```text
npm install
npm test
npm run build
node dist/cli.js plan /path/to/Cargo.toml
```
