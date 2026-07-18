import fs from "node:fs/promises";
import path from "node:path";
import {
  findRepositoryRootLexically,
  fullPath,
  isInside,
  normalizeGitPath,
  pathDepth,
  pathsEqual,
} from "../paths.js";
import type { FocusSelection } from "../inputs/types.js";
import { selectionSourceDirectories } from "../inputs/types.js";
import { GitCommandRunner } from "./git-runner.js";
import type {
  GitFocusState,
  GitFocusStatus,
  GitSparsePlan,
  RepositorySparsePlan,
} from "./types.js";

interface MutableRepositoryPlan {
  repositoryRoot: string;
  includeWholeRepository: boolean;
  includedPaths: Set<string>;
}

export class GitFocusService {
  private readonly git = new GitCommandRunner();

  plan(
    selection: FocusSelection,
    inputPath: string,
    repositoryPath: string,
  ): GitSparsePlan {
    const fullInputPath = fullPath(inputPath);
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    if (!isInside(primaryRoot, fullInputPath)) {
      throw new Error(
        `Input \`${fullInputPath}\` is outside the primary repository \`${primaryRoot}\`.`,
      );
    }

    const repositories = new Map<string, MutableRepositoryPlan>();

    for (const sourceDirectory of selectionSourceDirectories(selection)) {
      const fullSourceDirectory = fullPath(sourceDirectory);
      if (!isInside(primaryRoot, fullSourceDirectory)) {
        throw new Error(
          `Local dependency \`${fullSourceDirectory}\` is outside the primary repository \`${primaryRoot}\`. ` +
            "Cross-repository focus is not supported yet; use a submodule or place the dependency under the repository root.",
        );
      }

      const owningRoot = findRepositoryRootLexically(fullSourceDirectory);
      this.addPath(repositories, owningRoot, fullSourceDirectory);
      this.addNestedRepositoryChain(repositories, primaryRoot, owningRoot);
    }

    const repositoryPlans = [...repositories.values()]
      .sort((a, b) => pathDepth(a.repositoryRoot) - pathDepth(b.repositoryRoot))
      .map(
        (plan): RepositorySparsePlan => ({
          repositoryRoot: plan.repositoryRoot,
          includeWholeRepository: plan.includeWholeRepository,
          includedPaths: [...plan.includedPaths].sort((a, b) =>
            a.localeCompare(b),
          ),
        }),
      );

    return {
      primaryRepositoryRoot: primaryRoot,
      inputPath: fullInputPath,
      inputKind: selection.inputKind,
      rootProject: selection.root,
      projects: selection.projects,
      repositories: repositoryPlans,
    };
  }

  async apply(plan: GitSparsePlan, force: boolean): Promise<void> {
    if (await this.isFocused(plan.primaryRepositoryRoot)) {
      throw new Error(
        "This repository is already focused. Run `git-focus full` before selecting another input.",
      );
    }
    for (const repository of plan.repositories) {
      if (pathsEqual(repository.repositoryRoot, plan.primaryRepositoryRoot)) {
        continue;
      }
      if (await this.isSparseCheckout(repository.repositoryRoot)) {
        throw new Error(
          `Nested repository \`${repository.repositoryRoot}\` already uses sparse checkout. ` +
            "Restore its existing sparse state before applying git-focus.",
        );
      }
    }

    if (!force) {
      for (const repository of plan.repositories) {
        await this.ensureCleanWorkingTree(repository.repositoryRoot);
      }
    }

    const applied: RepositorySparsePlan[] = [];
    try {
      for (const repository of plan.repositories) {
        if (repository.includeWholeRepository) {
          continue;
        }

        await this.git.run(repository.repositoryRoot, [
          "sparse-checkout",
          "set",
          "--cone",
          "--sparse-index",
          "--skip-checks",
          ...repository.includedPaths,
        ]);
        applied.push(repository);
      }

      await this.writeState(plan);
    } catch (error) {
      for (const repository of applied.reverse()) {
        await this.git.tryRun(repository.repositoryRoot, [
          "sparse-checkout",
          "disable",
        ]);
      }
      throw error;
    }
  }

  async restoreFull(repositoryPath: string): Promise<void> {
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    const state = await this.readState(primaryRoot);
    const repositories = state?.repositories ?? [
      {
        repositoryRoot: primaryRoot,
        includeWholeRepository: false,
        includedPaths: [],
      },
    ];

    const ordered = [...repositories].sort(
      (a, b) => pathDepth(b.repositoryRoot) - pathDepth(a.repositoryRoot),
    );
    for (const repository of ordered) {
      if (repository.includeWholeRepository) {
        continue;
      }
      const { exitCode } = await this.git.tryRun(repository.repositoryRoot, [
        "config",
        "--bool",
        "core.sparseCheckout",
      ]);
      if (exitCode === 0) {
        await this.git.run(repository.repositoryRoot, [
          "sparse-checkout",
          "disable",
        ]);
      }
    }

    await this.deleteState(primaryRoot);
  }

  async getStatus(repositoryPath: string): Promise<GitFocusStatus> {
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    const state = await this.readState(primaryRoot);
    if (!state) {
      return {
        isFocused: false,
        primaryRepositoryRoot: primaryRoot,
        inputPath: null,
        inputKind: null,
        repositories: [],
      };
    }

    return {
      isFocused: true,
      primaryRepositoryRoot: primaryRoot,
      inputPath: state.inputPath,
      inputKind: state.inputKind,
      repositories: state.repositories,
    };
  }

  async ensureClean(repositoryPath: string, force: boolean): Promise<void> {
    if (force) {
      return;
    }
    const repositoryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    await this.ensureCleanWorkingTree(repositoryRoot);
  }

  private async ensureCleanWorkingTree(repositoryRoot: string): Promise<void> {
    const status = await this.git.run(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const changes = [...new Set(parseStatusPaths(status))].sort((a, b) =>
      a.localeCompare(b),
    );
    if (changes.length > 0) {
      throw new Error(
        `Repository \`${repositoryRoot}\` contains uncommitted changes. ` +
          `Commit or stash them before focusing, or pass \`--force\` to override:\n` +
          changes.map((item) => `  ${item}`).join("\n"),
      );
    }
  }

  private async isFocused(primaryRoot: string): Promise<boolean> {
    const state = await this.readState(primaryRoot);
    if (state) {
      return true;
    }

    return this.isSparseCheckout(primaryRoot);
  }

  private async isSparseCheckout(repositoryRoot: string): Promise<boolean> {
    const { exitCode, stdout } = await this.git.tryRun(repositoryRoot, [
      "config",
      "--bool",
      "core.sparseCheckout",
    ]);
    return exitCode === 0 && stdout.trim().toLowerCase() === "true";
  }

  private async writeState(plan: GitSparsePlan): Promise<void> {
    const statePath = await this.getStatePath(plan.primaryRepositoryRoot);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const state: GitFocusState = {
      inputPath: plan.inputPath,
      inputKind: String(plan.inputKind),
      repositories: plan.repositories,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async readState(primaryRoot: string): Promise<GitFocusState | null> {
    const statePath = await this.getStatePath(primaryRoot);
    try {
      const text = await fs.readFile(statePath, "utf8");
      return JSON.parse(text) as GitFocusState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async deleteState(primaryRoot: string): Promise<void> {
    const statePath = await this.getStatePath(primaryRoot);
    try {
      await fs.unlink(statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async getStatePath(primaryRoot: string): Promise<string> {
    const relative = (
      await this.git.run(primaryRoot, [
        "rev-parse",
        "--git-path",
        "git-focus/state.json",
      ])
    ).trim();
    return path.isAbsolute(relative)
      ? relative
      : path.resolve(primaryRoot, relative);
  }

  private addPath(
    repositories: Map<string, MutableRepositoryPlan>,
    repositoryRoot: string,
    sourceDirectory: string,
  ): void {
    const key = repositoryKey(repositoryRoot);
    let plan = repositories.get(key);
    if (!plan) {
      plan = {
        repositoryRoot: fullPath(repositoryRoot),
        includeWholeRepository: false,
        includedPaths: new Set(),
      };
      repositories.set(key, plan);
    }

    const relative = path.relative(plan.repositoryRoot, fullPath(sourceDirectory));
    if (relative === "") {
      plan.includeWholeRepository = true;
      return;
    }

    plan.includedPaths.add(normalizeGitPath(relative));
  }

  private addNestedRepositoryChain(
    repositories: Map<string, MutableRepositoryPlan>,
    primaryRoot: string,
    repositoryRoot: string,
  ): void {
    let nestedRoot = fullPath(repositoryRoot);
    while (!pathsEqual(nestedRoot, primaryRoot)) {
      const parentSearchStart = path.dirname(nestedRoot);
      if (parentSearchStart === nestedRoot) {
        throw new Error(`Repository \`${nestedRoot}\` has no parent.`);
      }
      const parentRoot = findRepositoryRootLexically(parentSearchStart);
      this.addPath(repositories, parentRoot, nestedRoot);
      nestedRoot = parentRoot;
    }
  }
}

function repositoryKey(repositoryRoot: string): string {
  const resolved = fullPath(repositoryRoot);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseStatusPaths(status: string): string[] {
  const paths: string[] = [];
  let position = 0;
  while (position < status.length) {
    if (position + 3 > status.length) {
      break;
    }

    const code = status.slice(position, position + 2);
    position += 3;
    const entry = readNullTerminated(status, position);
    position = entry.next;
    paths.push(normalizeGitPath(entry.value));
    if (code.includes("R") || code.includes("C")) {
      const renamed = readNullTerminated(status, position);
      position = renamed.next;
      paths.push(normalizeGitPath(renamed.value));
    }
  }
  return paths;
}

function readNullTerminated(
  value: string,
  position: number,
): { value: string; next: number } {
  const end = value.indexOf("\0", position);
  if (end < 0) {
    return { value: value.slice(position), next: value.length };
  }
  return {
    value: value.slice(position, end),
    next: Math.min(end + 1, value.length),
  };
}
