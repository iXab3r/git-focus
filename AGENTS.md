# Repository Instructions — git-focus

`git-focus` is a Node.js command-line tool that computes dependency-aware Git sparse-checkout scopes.

## Structure

- `src/` — CLI and implementation (TypeScript).
- `tests/` — unit and integration tests (Vitest).
- `.agents/skills/git-focus/` — reusable Agent Skill installed with the CLI.
- `.gitignore-focus-whitelist` — optional workspace overrides for the user-level preserve rules.

## Architecture

- Keep project-input discovery behind `ProjectInputResolver` so Cargo, MSBuild, and future ecosystems remain independent adapters.
- Keep dependency planning independent of Git mutation.
- Keep whitelist parsing and editing behind `FocusWhitelist`; merge user rules before workspace rules and reload both per operation.
- Use `execa` for external processes and `commander` for the CLI.
- Never remove ignored build caches such as `target/`, `bin/`, or `obj/` when changing focus.
- Fail before applying sparse checkout if any planned repository has staged, modified, or untracked files. Only an explicit `--force` bypasses this gate.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run bundle` before committing.
