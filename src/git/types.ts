import type { FocusSelection, ProjectInputKind, ProjectNode } from "../inputs/types.js";

export interface RepositorySparsePlan {
  repositoryRoot: string;
  includeWholeRepository: boolean;
  includedPaths: string[];
}

export interface GitSparsePlan {
  primaryRepositoryRoot: string;
  inputPath: string;
  inputKind: ProjectInputKind;
  rootProject: ProjectNode;
  projects: ProjectNode[];
  repositories: RepositorySparsePlan[];
}

export interface GitFocusStatus {
  isFocused: boolean;
  primaryRepositoryRoot: string;
  inputPath: string | null;
  inputKind: string | null;
  repositories: RepositorySparsePlan[];
}

export interface GitFocusState {
  inputPath: string;
  inputKind: string;
  repositories: RepositorySparsePlan[];
  createdAt: string;
}

export type { FocusSelection };
