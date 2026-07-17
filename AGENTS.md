# Repository Instructions — git-focus

`git-focus` is a .NET 10 command-line tool that computes dependency-aware Git sparse-checkout scopes.

## Structure

- `src/GitFocus/` — executable and implementation.
- `tests/GitFocus.Tests/` — unit and integration tests.
- `skills/git-focus/` — reusable Codex skill for operating the tool.

## Architecture

- Keep project-input discovery behind `IProjectInputResolver` so Cargo, MSBuild, and future ecosystems remain independent adapters.
- Keep dependency planning independent of Git mutation.
- Use `CliWrap` for external processes and `System.CommandLine` for the CLI.
- Never remove ignored build caches such as `target/`, `bin/`, or `obj/` when changing focus.
- Fail before applying sparse checkout if any planned repository has staged, modified, or untracked files. Only an explicit `--force` bypasses this gate.

## Verification

Run `dotnet format --verify-no-changes`, `dotnet build git-focus.slnx`, and `dotnet test git-focus.slnx` before committing.
