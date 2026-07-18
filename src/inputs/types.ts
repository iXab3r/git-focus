import { fullPath } from "../paths.js";

export type ProjectInputKind = "auto" | "cargo" | string;

export function parseProjectInputKind(value?: string | null): ProjectInputKind {
  if (!value || value.trim() === "") {
    return "auto";
  }
  return value.trim().toLowerCase();
}

export type ProjectDependencyKind = "runtime" | "build" | "development";

export interface ProjectDependency {
  targetId: string;
  kind: ProjectDependencyKind;
}

export interface ProjectNode {
  id: string;
  name: string;
  manifestPath: string;
  sourceDirectories: string[];
  dependencies: ProjectDependency[];
}

export interface ProjectGraph {
  inputKind: ProjectInputKind;
  rootId: string;
  nodes: Map<string, ProjectNode>;
}

export interface FocusRequest {
  inputPath: string;
  fullInputPath: string;
  inputKind: ProjectInputKind;
  includeDevelopmentDependencies: boolean;
}

export function createFocusRequest(
  inputPath: string,
  inputKind: ProjectInputKind = "auto",
  includeDevelopmentDependencies = true,
): FocusRequest {
  return {
    inputPath,
    fullInputPath: fullPath(inputPath),
    inputKind,
    includeDevelopmentDependencies,
  };
}

export interface FocusSelection {
  inputKind: ProjectInputKind;
  root: ProjectNode;
  projects: ProjectNode[];
}

export function selectionSourceDirectories(selection: FocusSelection): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const project of selection.projects) {
    for (const directory of project.sourceDirectories) {
      const resolved = fullPath(directory);
      const key =
        process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(resolved);
      }
    }
  }
  return result.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export interface ProjectInputResolver {
  readonly kind: ProjectInputKind;
  canResolve(request: FocusRequest): boolean;
  resolve(request: FocusRequest): Promise<ProjectGraph>;
}
