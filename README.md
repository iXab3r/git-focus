# git-focus

`git-focus` is a dependency-aware sparse-checkout controller for large Git repositories. It keeps build caches and Git history intact while reducing the source files exposed to editors, search tools, and coding agents.

The executable is also a Git extension, so `git-focus ...` and `git focus ...` are equivalent when it is on `PATH`.

## Commands

```text
git-focus path/to/Cargo.toml
git-focus plan path/to/Cargo.toml
git-focus status --repo path/to/repository
git-focus full --repo path/to/repository
```

The default command resolves the input project, computes its transitive local dependency closure, checks that no modified tracked path would be hidden, and applies cone-mode sparse checkout recursively to the repository containing the current directory and any nested repositories. Use `--repo` to choose a different explicit repository boundary. Untracked files, local symlinks, and ignored build caches remain in place.

`full` restores every repository recorded by the last focus operation. It does not fetch, pull, update submodule commits, or clean ignored files such as `target/`.

## Input adapters

Framework discovery is isolated behind `IProjectInputResolver`. The initial Cargo adapter uses `cargo metadata`; a future MSBuild adapter can produce the same framework-neutral graph without changing Git application or CLI orchestration.

## Development

Requires .NET SDK 10.

```text
dotnet build --configuration Release
dotnet test --configuration Release
dotnet run --project src/GitFocus -- plan /path/to/Cargo.toml
```
