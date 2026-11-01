import type { FocusSelection, ProjectInputKind, ProjectNode } from "../inputs/types.js";

export interface RepositorySparsePlan {
  repositoryRoot: string;
  includeWholeRepository: boolean;
  includedPaths: string[];
  whitelistedPaths?: string[];
}

export interface GitSparsePlan {
  primaryRepositoryRoot: string;
  inputPath: string;
  inputKind: ProjectInputKind;
  rootProject: ProjectNode;
  projects: ProjectNode[];
  repositories: RepositorySparsePlan[];
}

import type { PathRule } from "./path-focus.js";

export interface GitFocusStatus {
  pathRules?: PathRule[];
  remainingPaths?: string[];
  isFocused: boolean;
  primaryRepositoryRoot: string;
  inputPath: string | null;
  inputKind: string | null;
  repositories: RepositorySparsePlan[];
}

export interface GitFocusState {
  pathRules?: PathRule[];
  inputPath: string;
  inputKind: string;
  repositories: RepositorySparsePlan[];
  createdAt: string;
}

export type { FocusSelection };
