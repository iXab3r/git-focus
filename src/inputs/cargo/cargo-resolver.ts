import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { formatProcessFailure } from "../../process-error.js";
import {
  findNearestFile,
  fullPath,
  isInside,
  pathsEqual,
  resolveDirectoryLink,
} from "../../paths.js";
import type {
  FocusRequest,
  ProjectDependency,
  ProjectGraph,
  ProjectInputResolver,
  ProjectNode,
} from "../types.js";

interface CargoMetadata {
  packages: CargoPackage[];
  resolve: CargoResolve | null;
  workspace_root: string;
}

interface CargoPackage {
  id: string;
  name: string;
  source: string | null;
  manifest_path: string;
  dependencies: CargoPackageDependency[];
  targets: CargoTarget[];
}

interface CargoTarget {
  src_path: string;
}

interface CargoPackageDependency {
  name: string;
  path: string | null;
}

interface CargoResolve {
  nodes: CargoResolveNode[];
}

interface CargoResolveNode {
  id: string;
  deps: CargoResolvedDependency[];
}

interface CargoResolvedDependency {
  pkg: string;
  dep_kinds: CargoDependencyKind[];
}

interface CargoDependencyKind {
  kind: string | null;
}

export class CargoProjectInputResolver implements ProjectInputResolver {
  readonly kind = "cargo";

  canResolve(request: FocusRequest): boolean {
    return path.basename(request.fullInputPath).toLowerCase() === "cargo.toml";
  }

  async resolve(request: FocusRequest): Promise<ProjectGraph> {
    if (!fs.existsSync(request.fullInputPath)) {
      throw new Error(
        `Cargo manifest does not exist: ${request.fullInputPath}`,
      );
    }

    const workingDirectory = path.dirname(request.fullInputPath);
    const arguments_ = [
      "metadata",
      "--format-version",
      "1",
      "--all-features",
      "--manifest-path",
      request.fullInputPath,
    ];

    const lockFile = findNearestFile(workingDirectory, "Cargo.lock");
    if (lockFile) {
      arguments_.push("--locked");
    }

    const result = await execa("cargo", arguments_, {
      cwd: workingDirectory,
      reject: false,
      all: false,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `${formatProcessFailure("cargo metadata", result)}\nManifest: ${request.fullInputPath}`,
      );
    }

    const metadata = JSON.parse(result.stdout) as CargoMetadata;
    if (!metadata.resolve) {
      throw new Error(
        "cargo metadata did not return a resolved dependency graph.",
      );
    }

    const localPackages = new Map(
      metadata.packages
        .filter((package_) => package_.source === null)
        .map((package_) => [package_.id, package_] as const),
    );
    const rootPackage = findRootPackage(
      request.fullInputPath,
      [...localPackages.values()],
    );
    const sourceDirectories = new Map(
      [...localPackages.values()].map((package_) => [
        package_.id,
        createSourceDirectories(package_),
      ]),
    );

    const requestedDirectory = path.dirname(request.fullInputPath);
    sourceDirectories
      .get(rootPackage.id)!
      .add(requestedDirectory)
      .add(resolveDirectoryLink(requestedDirectory));
    addWorkspaceCargoConfigDirectories(
      sourceDirectories.get(rootPackage.id)!,
      requestedDirectory,
      metadata.workspace_root,
    );

    addDeclaredPathAliases(localPackages, sourceDirectories);

    const resolvedNodes = new Map(
      metadata.resolve.nodes.map((node) => [node.id, node] as const),
    );
    const nodes = new Map<string, ProjectNode>();

    for (const package_ of localPackages.values()) {
      const resolvedNode = resolvedNodes.get(package_.id);
      const dependencies =
        resolvedNode?.deps
          .filter((dependency) => localPackages.has(dependency.pkg))
          .flatMap((dependency) => toDependencies(dependency))
          .filter(distinctDependency) ?? [];

      const directories = [...sourceDirectories.get(package_.id)!].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );

      nodes.set(package_.id, {
        id: package_.id,
        name: package_.name,
        manifestPath: fullPath(package_.manifest_path),
        sourceDirectories: directories,
        dependencies,
      });
    }

    return {
      inputKind: this.kind,
      rootId: rootPackage.id,
      nodes,
    };
  }
}

function createSourceDirectories(package_: CargoPackage): SetWithIgnoreCase {
  const manifestDirectory = path.dirname(fullPath(package_.manifest_path));
  const directories = new SetWithIgnoreCase([
    manifestDirectory,
    resolveDirectoryLink(manifestDirectory),
  ]);
  for (const target of package_.targets) {
    directories.add(path.dirname(fullPath(target.src_path)));
    directories.add(path.dirname(resolveDirectoryLink(target.src_path)));
  }
  return directories;
}

function addWorkspaceCargoConfigDirectories(
  directories: SetWithIgnoreCase,
  startDirectory: string,
  workspaceRoot: string,
): void {
  const root = fullPath(workspaceRoot);
  let current = fullPath(startDirectory);
  while (isInside(root, current)) {
    const cargoDirectory = path.join(current, ".cargo");
    if (
      fs.existsSync(cargoDirectory) &&
      fs.statSync(cargoDirectory).isDirectory()
    ) {
      directories.add(cargoDirectory).add(resolveDirectoryLink(cargoDirectory));
    }
    if (pathsEqual(current, root)) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

function findRootPackage(
  manifestPath: string,
  packages: CargoPackage[],
): CargoPackage {
  const requestedDirectory = path.dirname(fullPath(manifestPath));
  const requestedCanonicalDirectory = resolveDirectoryLink(requestedDirectory);
  const match = packages.find(
    (package_) =>
      pathsEqual(package_.manifest_path, manifestPath) ||
      pathsEqual(
        resolveDirectoryLink(path.dirname(package_.manifest_path)),
        requestedCanonicalDirectory,
      ),
  );
  if (!match) {
    throw new Error(
      `cargo metadata did not include the requested manifest \`${manifestPath}\` as a local package.`,
    );
  }
  return match;
}

function addDeclaredPathAliases(
  localPackages: Map<string, CargoPackage>,
  sourceDirectories: Map<string, SetWithIgnoreCase>,
): void {
  for (const package_ of localPackages.values()) {
    for (const dependency of package_.dependencies.filter(
      (item) => item.path !== null,
    )) {
      const candidates = [...localPackages.values()].filter(
        (candidate) =>
          candidate.name === dependency.name ||
          pathsEqual(
            path.dirname(candidate.manifest_path),
            resolveDirectoryLink(dependency.path!),
          ),
      );
      if (candidates.length === 1) {
        sourceDirectories
          .get(candidates[0]!.id)!
          .add(fullPath(dependency.path!));
      }
    }
  }
}

function toDependencies(
  dependency: CargoResolvedDependency,
): ProjectDependency[] {
  if (dependency.dep_kinds.length === 0) {
    return [{ targetId: dependency.pkg, kind: "runtime" }];
  }

  const kinds = new Set(
    dependency.dep_kinds.map((item) => item.kind ?? "normal"),
  );
  return [...kinds].map((kind) => ({
    targetId: dependency.pkg,
    kind:
      kind === "dev"
        ? "development"
        : kind === "build"
          ? "build"
          : "runtime",
  }));
}

function distinctDependency(
  dependency: ProjectDependency,
  index: number,
  all: ProjectDependency[],
): boolean {
  return (
    all.findIndex(
      (item) =>
        item.targetId === dependency.targetId && item.kind === dependency.kind,
    ) === index
  );
}

class SetWithIgnoreCase {
  private readonly map = new Map<string, string>();

  constructor(values: Iterable<string> = []) {
    for (const value of values) {
      this.add(value);
    }
  }

  add(value: string): this {
    const resolved = fullPath(value);
    const key =
      process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!this.map.has(key)) {
      this.map.set(key, resolved);
    }
    return this;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.map.values();
  }
}
