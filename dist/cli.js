#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";

// src/skill-installer.ts
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
async function installGitFocusSkill(options = {}) {
  const packageRoot = options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const userHome = options.userHome ?? process.env.GIT_FOCUS_SKILL_HOME ?? os.homedir();
  const source = path.join(
    packageRoot,
    ".agents",
    "skills",
    "git-focus"
  );
  const target = path.join(userHome, ".agents", "skills", "git-focus");
  await fs.access(path.join(source, "SKILL.md"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
  return target;
}

// src/inputs/cargo/cargo-resolver.ts
import fs3 from "fs";
import path3 from "path";
import { execa } from "execa";

// src/process-error.ts
function formatProcessFailure(command, result) {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const detail = stderr || result.shortMessage?.trim() || "No error output was provided.";
  const exit = typeof result.exitCode === "number" ? ` exited with code ${result.exitCode}` : " could not be started";
  return `${command}${exit}:
${detail}`;
}

// src/paths.ts
import fs2 from "fs";
import path2 from "path";
function fullPath(value) {
  return path2.resolve(value);
}
function pathsEqual(left, right) {
  const a = trimTrailingSeparators(fullPath(left));
  const b = trimTrailingSeparators(fullPath(right));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function isInside(root, candidate) {
  const relative = path2.relative(fullPath(root), fullPath(candidate));
  return relative === "" || !relative.startsWith(`..${path2.sep}`) && relative !== ".." && !path2.isAbsolute(relative);
}
function pathDepth(value) {
  return fullPath(value).split(path2.sep).filter(Boolean).length;
}
function normalizeGitPath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}
function resolveDirectoryLink(value) {
  const resolved = fullPath(value);
  try {
    return fs2.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
function findNearestFile(startDirectory, fileName) {
  let current = fullPath(startDirectory);
  for (; ; ) {
    const candidate = path2.join(current, fileName);
    if (fs2.existsSync(candidate) && fs2.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path2.dirname(current);
    if (parent === current) {
      return void 0;
    }
    current = parent;
  }
}
function findRepositoryRootLexically(startPath) {
  const start = fs2.existsSync(startPath) && fs2.statSync(startPath).isDirectory() ? startPath : path2.dirname(startPath);
  let current = fullPath(start);
  for (; ; ) {
    const marker = path2.join(current, ".git");
    if (fs2.existsSync(marker)) {
      return current;
    }
    const parent = path2.dirname(current);
    if (parent === current) {
      throw new Error(`\`${startPath}\` is not inside a Git repository.`);
    }
    current = parent;
  }
}
function trimTrailingSeparators(value) {
  if (value.length <= 1) {
    return value;
  }
  return value.replace(/[/\\]+$/, "");
}

// src/inputs/cargo/cargo-resolver.ts
var CargoProjectInputResolver = class {
  kind = "cargo";
  canResolve(request) {
    return path3.basename(request.fullInputPath).toLowerCase() === "cargo.toml";
  }
  async resolve(request) {
    if (!fs3.existsSync(request.fullInputPath)) {
      throw new Error(
        `Cargo manifest does not exist: ${request.fullInputPath}`
      );
    }
    const workingDirectory = path3.dirname(request.fullInputPath);
    const arguments_ = [
      "metadata",
      "--format-version",
      "1",
      "--all-features",
      "--manifest-path",
      request.fullInputPath
    ];
    const lockFile = findNearestFile(workingDirectory, "Cargo.lock");
    if (lockFile) {
      arguments_.push("--locked");
    }
    const result = await execa("cargo", arguments_, {
      cwd: workingDirectory,
      reject: false,
      all: false
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${formatProcessFailure("cargo metadata", result)}
Manifest: ${request.fullInputPath}`
      );
    }
    const metadata = JSON.parse(result.stdout);
    if (!metadata.resolve) {
      throw new Error(
        "cargo metadata did not return a resolved dependency graph."
      );
    }
    const localPackages = new Map(
      metadata.packages.filter((package_) => package_.source === null).map((package_) => [package_.id, package_])
    );
    const rootPackage = findRootPackage(
      request.fullInputPath,
      [...localPackages.values()]
    );
    const sourceDirectories = new Map(
      [...localPackages.values()].map((package_) => [
        package_.id,
        createSourceDirectories(package_)
      ])
    );
    const requestedDirectory = path3.dirname(request.fullInputPath);
    sourceDirectories.get(rootPackage.id).add(requestedDirectory).add(resolveDirectoryLink(requestedDirectory));
    addWorkspaceCargoConfigDirectories(
      sourceDirectories.get(rootPackage.id),
      requestedDirectory,
      metadata.workspace_root
    );
    addDeclaredPathAliases(localPackages, sourceDirectories);
    const resolvedNodes = new Map(
      metadata.resolve.nodes.map((node) => [node.id, node])
    );
    const nodes = /* @__PURE__ */ new Map();
    for (const package_ of localPackages.values()) {
      const resolvedNode = resolvedNodes.get(package_.id);
      const dependencies = resolvedNode?.deps.filter((dependency) => localPackages.has(dependency.pkg)).flatMap((dependency) => toDependencies(dependency)).filter(distinctDependency) ?? [];
      const directories = [...sourceDirectories.get(package_.id)].sort(
        (a, b) => a.localeCompare(b, void 0, { sensitivity: "base" })
      );
      nodes.set(package_.id, {
        id: package_.id,
        name: package_.name,
        manifestPath: fullPath(package_.manifest_path),
        sourceDirectories: directories,
        dependencies
      });
    }
    return {
      inputKind: this.kind,
      rootId: rootPackage.id,
      nodes
    };
  }
};
function createSourceDirectories(package_) {
  const manifestDirectory = path3.dirname(fullPath(package_.manifest_path));
  const directories = new SetWithIgnoreCase([
    manifestDirectory,
    resolveDirectoryLink(manifestDirectory)
  ]);
  for (const target of package_.targets) {
    directories.add(path3.dirname(fullPath(target.src_path)));
    directories.add(path3.dirname(resolveDirectoryLink(target.src_path)));
  }
  return directories;
}
function addWorkspaceCargoConfigDirectories(directories, startDirectory, workspaceRoot) {
  const root = fullPath(workspaceRoot);
  let current = fullPath(startDirectory);
  while (isInside(root, current)) {
    const cargoDirectory = path3.join(current, ".cargo");
    if (fs3.existsSync(cargoDirectory) && fs3.statSync(cargoDirectory).isDirectory()) {
      directories.add(cargoDirectory).add(resolveDirectoryLink(cargoDirectory));
    }
    if (pathsEqual(current, root)) {
      break;
    }
    const parent = path3.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}
function findRootPackage(manifestPath, packages) {
  const requestedDirectory = path3.dirname(fullPath(manifestPath));
  const requestedCanonicalDirectory = resolveDirectoryLink(requestedDirectory);
  const match = packages.find(
    (package_) => pathsEqual(package_.manifest_path, manifestPath) || pathsEqual(
      resolveDirectoryLink(path3.dirname(package_.manifest_path)),
      requestedCanonicalDirectory
    )
  );
  if (!match) {
    throw new Error(
      `cargo metadata did not include the requested manifest \`${manifestPath}\` as a local package.`
    );
  }
  return match;
}
function addDeclaredPathAliases(localPackages, sourceDirectories) {
  for (const package_ of localPackages.values()) {
    for (const dependency of package_.dependencies.filter(
      (item) => item.path !== null
    )) {
      const candidates = [...localPackages.values()].filter(
        (candidate) => candidate.name === dependency.name || pathsEqual(
          path3.dirname(candidate.manifest_path),
          resolveDirectoryLink(dependency.path)
        )
      );
      if (candidates.length === 1) {
        sourceDirectories.get(candidates[0].id).add(fullPath(dependency.path));
      }
    }
  }
}
function toDependencies(dependency) {
  if (dependency.dep_kinds.length === 0) {
    return [{ targetId: dependency.pkg, kind: "runtime" }];
  }
  const kinds = new Set(
    dependency.dep_kinds.map((item) => item.kind ?? "normal")
  );
  return [...kinds].map((kind) => ({
    targetId: dependency.pkg,
    kind: kind === "dev" ? "development" : kind === "build" ? "build" : "runtime"
  }));
}
function distinctDependency(dependency, index, all) {
  return all.findIndex(
    (item) => item.targetId === dependency.targetId && item.kind === dependency.kind
  ) === index;
}
var SetWithIgnoreCase = class {
  map = /* @__PURE__ */ new Map();
  constructor(values = []) {
    for (const value of values) {
      this.add(value);
    }
  }
  add(value) {
    const resolved = fullPath(value);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!this.map.has(key)) {
      this.map.set(key, resolved);
    }
    return this;
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
};

// src/inputs/registry.ts
var ProjectInputResolverRegistry = class {
  resolvers;
  constructor(resolvers) {
    this.resolvers = [...resolvers];
    if (this.resolvers.length === 0) {
      throw new Error("At least one project input resolver is required.");
    }
  }
  resolve(request) {
    if (request.inputKind !== "auto") {
      const match = this.resolvers.find(
        (resolver) => resolver.kind === request.inputKind
      );
      if (!match) {
        throw new Error(
          `No resolver is registered for input type \`${request.inputKind}\`. Available types: ${this.availableKinds()}.`
        );
      }
      return match;
    }
    const matches = this.resolvers.filter(
      (resolver) => resolver.canResolve(request)
    );
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length === 0) {
      throw new Error(
        `No resolver recognizes \`${request.fullInputPath}\`. Available types: ${this.availableKinds()}.`
      );
    }
    throw new Error(
      `Multiple resolvers recognize \`${request.fullInputPath}\`; specify --type explicitly.`
    );
  }
  availableKinds() {
    return this.resolvers.map((resolver) => resolver.kind).join(", ");
  }
};

// src/inputs/types.ts
function parseProjectInputKind(value) {
  if (!value || value.trim() === "") {
    return "auto";
  }
  return value.trim().toLowerCase();
}
function createFocusRequest(inputPath, inputKind = "auto", includeDevelopmentDependencies = true) {
  return {
    inputPath,
    fullInputPath: fullPath(inputPath),
    inputKind,
    includeDevelopmentDependencies
  };
}
function selectionSourceDirectories(selection) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const project of selection.projects) {
    for (const directory of project.sourceDirectories) {
      const resolved = fullPath(directory);
      const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(resolved);
      }
    }
  }
  return result.sort(
    (a, b) => a.localeCompare(b, void 0, { sensitivity: "base" })
  );
}

// src/planning/focus-planner.ts
var FocusPlanner = class {
  constructor(registry) {
    this.registry = registry;
  }
  registry;
  async plan(request) {
    const resolver = this.registry.resolve(request);
    const graph = await resolver.resolve(request);
    const root = graph.nodes.get(graph.rootId);
    if (!root) {
      throw new Error(
        `Input resolver \`${resolver.kind}\` returned an unknown root node.`
      );
    }
    const selected = /* @__PURE__ */ new Set();
    const pending = [graph.rootId];
    while (pending.length > 0) {
      const nodeId = pending.shift();
      if (selected.has(nodeId)) {
        continue;
      }
      selected.add(nodeId);
      const node = graph.nodes.get(nodeId);
      if (!node) {
        throw new Error(
          `Input resolver \`${resolver.kind}\` returned dependency \`${nodeId}\` without a project node.`
        );
      }
      for (const dependency of node.dependencies) {
        if (dependency.kind === "development" && !request.includeDevelopmentDependencies) {
          continue;
        }
        pending.push(dependency.targetId);
      }
    }
    const projects = [...selected].map((id) => graph.nodes.get(id)).sort((left, right) => {
      const byName = left.name.localeCompare(right.name, void 0, {
        sensitivity: "base"
      });
      if (byName !== 0) {
        return byName;
      }
      return left.manifestPath.localeCompare(right.manifestPath, void 0, {
        sensitivity: "base"
      });
    });
    return {
      inputKind: graph.inputKind,
      root,
      projects
    };
  }
};

// src/git/git-focus-service.ts
import fs5 from "fs/promises";
import path5 from "path";

// src/whitelist/focus-whitelist.ts
import fs4 from "fs/promises";
import path4 from "path";
import ignore from "ignore";

// src/git/git-runner.ts
import { execa as execa2 } from "execa";
var GitCommandRunner = class {
  constructor(executable = "git") {
    this.executable = executable;
  }
  executable;
  async run(repositoryRoot, arguments_) {
    const result = await execa2(
      this.executable,
      ["-C", repositoryRoot, ...arguments_],
      {
        reject: false,
        encoding: "utf8"
      }
    );
    if (result.exitCode !== 0) {
      const command = `git ${arguments_.join(" ")}`;
      throw new Error(
        `${formatProcessFailure(command, result)}
Repository: ${repositoryRoot}`
      );
    }
    return result.stdout ?? "";
  }
  async tryRun(repositoryRoot, arguments_) {
    const result = await execa2(
      this.executable,
      ["-C", repositoryRoot, ...arguments_],
      {
        reject: false,
        encoding: "utf8"
      }
    );
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout ?? "" };
  }
};

// src/whitelist/focus-whitelist.ts
var FOCUS_WHITELIST_FILE = ".gitignore-focus-whitelist";
var FocusWhitelist = class {
  constructor(git = new GitCommandRunner()) {
    this.git = git;
  }
  git;
  repositoryRoot(repositoryPath) {
    return findRepositoryRootLexically(fullPath(repositoryPath));
  }
  filePath(repositoryPath) {
    return path4.join(this.repositoryRoot(repositoryPath), FOCUS_WHITELIST_FILE);
  }
  async read(repositoryPath) {
    try {
      return await fs4.readFile(this.filePath(repositoryPath), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
  async add(repositoryPath, pattern) {
    validatePattern(pattern);
    const current = await this.read(repositoryPath);
    const lines = splitLines(current);
    if (lines.includes(pattern)) {
      return false;
    }
    lines.push(pattern);
    await this.write(repositoryPath, lines);
    return true;
  }
  async remove(repositoryPath, pattern) {
    validatePattern(pattern);
    const current = await this.read(repositoryPath);
    const lines = splitLines(current);
    const remaining = lines.filter((line) => line !== pattern);
    if (remaining.length === lines.length) {
      return false;
    }
    await this.write(repositoryPath, remaining);
    return true;
  }
  async match(repositoryPath, candidatePath) {
    const repositoryRoot = this.repositoryRoot(repositoryPath);
    const relativePath = normalizeCandidate(repositoryRoot, candidatePath);
    const matcher = await this.matcher(repositoryRoot);
    let matched = matcher.ignores(relativePath);
    if (!matched) {
      try {
        const stats = await fs4.stat(path4.join(repositoryRoot, relativePath));
        if (stats.isDirectory()) {
          matched = matcher.ignores(`${relativePath}/`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return { repositoryRoot, relativePath, matched };
  }
  async matchedTrackedDirectories(repositoryPath) {
    const repositoryRoot = this.repositoryRoot(repositoryPath);
    const matcher = await this.matcher(repositoryRoot);
    const tracked = await this.git.run(repositoryRoot, ["ls-files", "-z"]);
    const directories = /* @__PURE__ */ new Set();
    for (const entry of tracked.split("\0")) {
      if (!entry) {
        continue;
      }
      const fullEntry = path4.join(repositoryRoot, entry);
      let isDirectory = false;
      try {
        isDirectory = (await fs4.stat(fullEntry)).isDirectory();
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      if (!matcher.ignores(entry) && !(isDirectory && matcher.ignores(`${entry}/`))) {
        continue;
      }
      let relativeDirectory = normalizeGitPath(path4.dirname(entry));
      if (isDirectory) {
        relativeDirectory = normalizeGitPath(entry);
      }
      if (relativeDirectory !== ".") {
        directories.add(relativeDirectory);
      }
    }
    return minimizeDirectories([...directories]);
  }
  async matcher(repositoryPath) {
    return ignore().add(await this.read(repositoryPath));
  }
  async write(repositoryPath, lines) {
    const filePath = this.filePath(repositoryPath);
    const contents = lines.length > 0 ? `${lines.join("\n")}
` : "";
    await fs4.writeFile(filePath, contents, "utf8");
  }
};
function normalizeCandidate(repositoryRoot, candidatePath) {
  const fullCandidate = path4.isAbsolute(candidatePath) ? fullPath(candidatePath) : fullPath(path4.join(repositoryRoot, candidatePath));
  if (!isInside(repositoryRoot, fullCandidate)) {
    throw new Error(
      `Path \`${fullCandidate}\` is outside repository \`${repositoryRoot}\`.`
    );
  }
  const relative = normalizeGitPath(
    path4.relative(repositoryRoot, fullCandidate)
  );
  if (relative === "") {
    throw new Error(
      "A repository-relative path is required for whitelist matching."
    );
  }
  return relative;
}
function splitLines(contents) {
  if (contents === "") {
    return [];
  }
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
function validatePattern(pattern) {
  if (pattern.trim() === "") {
    throw new Error("Whitelist pattern cannot be empty.");
  }
  ignore().add(pattern);
}
function minimizeDirectories(directories) {
  const ordered = directories.sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  });
  const result = [];
  for (const directory of ordered) {
    if (!result.some(
      (parent) => directory === parent || directory.startsWith(`${parent}/`)
    )) {
      result.push(directory);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

// src/git/git-focus-service.ts
var GitFocusService = class {
  constructor(git = new GitCommandRunner(), whitelist = new FocusWhitelist(git)) {
    this.git = git;
    this.whitelist = whitelist;
  }
  git;
  whitelist;
  async plan(selection, inputPath, repositoryPath) {
    const fullInputPath = fullPath(inputPath);
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    if (!isInside(primaryRoot, fullInputPath)) {
      throw new Error(
        `Input \`${fullInputPath}\` is outside the primary repository \`${primaryRoot}\`.`
      );
    }
    const repositories = /* @__PURE__ */ new Map();
    for (const sourceDirectory of selectionSourceDirectories(selection)) {
      const fullSourceDirectory = fullPath(sourceDirectory);
      if (!isInside(primaryRoot, fullSourceDirectory)) {
        throw new Error(
          `Local dependency \`${fullSourceDirectory}\` is outside the primary repository \`${primaryRoot}\`. Cross-repository focus is not supported yet; use a submodule or place the dependency under the repository root.`
        );
      }
      const owningRoot = findRepositoryRootLexically(fullSourceDirectory);
      this.addPath(repositories, owningRoot, fullSourceDirectory);
      this.addNestedRepositoryChain(repositories, primaryRoot, owningRoot);
    }
    for (const repository of [...repositories.values()]) {
      const whitelistedDirectories = await this.whitelist.matchedTrackedDirectories(
        repository.repositoryRoot
      );
      for (const directory of whitelistedDirectories) {
        this.addPath(
          repositories,
          repository.repositoryRoot,
          path5.join(repository.repositoryRoot, directory),
          true
        );
      }
    }
    const repositoryPlans = [...repositories.values()].sort((a, b) => pathDepth(a.repositoryRoot) - pathDepth(b.repositoryRoot)).map(
      (plan) => ({
        repositoryRoot: plan.repositoryRoot,
        includeWholeRepository: plan.includeWholeRepository,
        includedPaths: [...plan.includedPaths].sort(
          (a, b) => a.localeCompare(b)
        ),
        whitelistedPaths: [...plan.whitelistedPaths].sort(
          (a, b) => a.localeCompare(b)
        )
      })
    );
    return {
      primaryRepositoryRoot: primaryRoot,
      inputPath: fullInputPath,
      inputKind: selection.inputKind,
      rootProject: selection.root,
      projects: selection.projects,
      repositories: repositoryPlans
    };
  }
  async apply(plan, force) {
    if (await this.isFocused(plan.primaryRepositoryRoot)) {
      throw new Error(
        "This repository is already focused. Run `git-focus full` before selecting another input."
      );
    }
    for (const repository of plan.repositories) {
      if (pathsEqual(repository.repositoryRoot, plan.primaryRepositoryRoot)) {
        continue;
      }
      if (await this.isSparseCheckout(repository.repositoryRoot)) {
        throw new Error(
          `Nested repository \`${repository.repositoryRoot}\` already uses sparse checkout. Restore its existing sparse state before applying git-focus.`
        );
      }
    }
    if (!force) {
      for (const repository of plan.repositories) {
        await this.ensureCleanWorkingTree(repository.repositoryRoot);
      }
    }
    const applied = [];
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
          ...repository.includedPaths
        ]);
        applied.push(repository);
      }
      await this.writeState(plan);
    } catch (error) {
      for (const repository of applied.reverse()) {
        await this.git.tryRun(repository.repositoryRoot, [
          "sparse-checkout",
          "disable"
        ]);
      }
      throw error;
    }
  }
  async restoreFull(repositoryPath) {
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    const state = await this.readState(primaryRoot);
    const repositories = state?.repositories ?? [
      {
        repositoryRoot: primaryRoot,
        includeWholeRepository: false,
        includedPaths: []
      }
    ];
    const ordered = [...repositories].sort(
      (a, b) => pathDepth(b.repositoryRoot) - pathDepth(a.repositoryRoot)
    );
    for (const repository of ordered) {
      if (repository.includeWholeRepository) {
        continue;
      }
      const { exitCode } = await this.git.tryRun(repository.repositoryRoot, [
        "config",
        "--bool",
        "core.sparseCheckout"
      ]);
      if (exitCode === 0) {
        await this.git.run(repository.repositoryRoot, [
          "sparse-checkout",
          "disable"
        ]);
      }
    }
    await this.deleteState(primaryRoot);
  }
  async getStatus(repositoryPath) {
    const primaryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    const state = await this.readState(primaryRoot);
    if (!state) {
      return {
        isFocused: false,
        primaryRepositoryRoot: primaryRoot,
        inputPath: null,
        inputKind: null,
        repositories: []
      };
    }
    return {
      isFocused: true,
      primaryRepositoryRoot: primaryRoot,
      inputPath: state.inputPath,
      inputKind: state.inputKind,
      repositories: state.repositories
    };
  }
  async ensureClean(repositoryPath, force) {
    if (force) {
      return;
    }
    const repositoryRoot = findRepositoryRootLexically(fullPath(repositoryPath));
    await this.ensureCleanWorkingTree(repositoryRoot);
  }
  async ensureCleanWorkingTree(repositoryRoot) {
    const status = await this.git.run(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all"
    ]);
    const changes = [...new Set(parseStatusPaths(status))].sort(
      (a, b) => a.localeCompare(b)
    );
    if (changes.length > 0) {
      throw new Error(
        `Repository \`${repositoryRoot}\` contains uncommitted changes. Commit or stash them before focusing, or pass \`--force\` to override:
` + changes.map((item) => `  ${item}`).join("\n")
      );
    }
  }
  async isFocused(primaryRoot) {
    const state = await this.readState(primaryRoot);
    if (state) {
      return true;
    }
    return this.isSparseCheckout(primaryRoot);
  }
  async isSparseCheckout(repositoryRoot) {
    const { exitCode, stdout } = await this.git.tryRun(repositoryRoot, [
      "config",
      "--bool",
      "core.sparseCheckout"
    ]);
    return exitCode === 0 && stdout.trim().toLowerCase() === "true";
  }
  async writeState(plan) {
    const statePath = await this.getStatePath(plan.primaryRepositoryRoot);
    await fs5.mkdir(path5.dirname(statePath), { recursive: true });
    const state = {
      inputPath: plan.inputPath,
      inputKind: String(plan.inputKind),
      repositories: plan.repositories,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await fs5.writeFile(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
  }
  async readState(primaryRoot) {
    const statePath = await this.getStatePath(primaryRoot);
    try {
      const text = await fs5.readFile(statePath, "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
  async deleteState(primaryRoot) {
    const statePath = await this.getStatePath(primaryRoot);
    try {
      await fs5.unlink(statePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  async getStatePath(primaryRoot) {
    const relative = (await this.git.run(primaryRoot, [
      "rev-parse",
      "--git-path",
      "git-focus/state.json"
    ])).trim();
    return path5.isAbsolute(relative) ? relative : path5.resolve(primaryRoot, relative);
  }
  addPath(repositories, repositoryRoot, sourceDirectory, whitelisted = false) {
    const key = repositoryKey(repositoryRoot);
    let plan = repositories.get(key);
    if (!plan) {
      plan = {
        repositoryRoot: fullPath(repositoryRoot),
        includeWholeRepository: false,
        includedPaths: /* @__PURE__ */ new Set(),
        whitelistedPaths: /* @__PURE__ */ new Set()
      };
      repositories.set(key, plan);
    }
    const relative = path5.relative(plan.repositoryRoot, fullPath(sourceDirectory));
    if (relative === "") {
      plan.includeWholeRepository = true;
      return;
    }
    const gitPath = normalizeGitPath(relative);
    plan.includedPaths.add(gitPath);
    if (whitelisted) {
      plan.whitelistedPaths.add(gitPath);
    }
  }
  addNestedRepositoryChain(repositories, primaryRoot, repositoryRoot) {
    let nestedRoot = fullPath(repositoryRoot);
    while (!pathsEqual(nestedRoot, primaryRoot)) {
      const parentSearchStart = path5.dirname(nestedRoot);
      if (parentSearchStart === nestedRoot) {
        throw new Error(`Repository \`${nestedRoot}\` has no parent.`);
      }
      const parentRoot = findRepositoryRootLexically(parentSearchStart);
      this.addPath(repositories, parentRoot, nestedRoot);
      nestedRoot = parentRoot;
    }
  }
};
function repositoryKey(repositoryRoot) {
  const resolved = fullPath(repositoryRoot);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function parseStatusPaths(status) {
  const paths = [];
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
function readNullTerminated(value, position) {
  const end = value.indexOf("\0", position);
  if (end < 0) {
    return { value: value.slice(position), next: value.length };
  }
  return {
    value: value.slice(position, end),
    next: Math.min(end + 1, value.length)
  };
}

// src/cli.ts
function createServices() {
  const resolvers = [new CargoProjectInputResolver()];
  const gitRunner = new GitCommandRunner();
  const whitelist = new FocusWhitelist(gitRunner);
  return {
    planner: new FocusPlanner(new ProjectInputResolverRegistry(resolvers)),
    git: new GitFocusService(gitRunner, whitelist),
    whitelist
  };
}
function printPlan(plan) {
  console.log(`Input type: ${plan.inputKind}`);
  console.log(`Root project: ${plan.rootProject.name}`);
  console.log(`Projects (${plan.projects.length}):`);
  for (const project of plan.projects) {
    console.log(`  ${project.name}  ${project.manifestPath}`);
  }
  console.log(`Repositories (${plan.repositories.length}):`);
  for (const repository of plan.repositories) {
    console.log(`  ${repository.repositoryRoot}`);
    if (repository.includeWholeRepository) {
      console.log("    <full repository>");
      continue;
    }
    const whitelisted = new Set(repository.whitelistedPaths ?? []);
    for (const included of repository.includedPaths) {
      const source = whitelisted.has(included) ? " [whitelist]" : "";
      console.log(`    ${included}${source}`);
    }
  }
}
async function run(operation) {
  try {
    await operation(createServices());
    return 0;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Operation cancelled.");
      return 130;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
var program = new Command();
program.configureHelp({ showGlobalOptions: true });
program.name("git-focus").description(
  "Focus a Git monorepo to one project and its local dependency closure."
).argument("[input]", "Project input to focus, such as path/to/Cargo.toml.").option("--type <type>", "Input adapter type. Defaults to auto detection.", "auto").option("--without-dev", "Exclude development-only local dependencies.", false).option(
  "--force",
  "Allow focusing repositories that contain uncommitted changes.",
  false
).option(
  "--repo <path>",
  "Primary repository boundary. Defaults to the repository containing the current directory.",
  process.cwd()
).action(async (input, options) => {
  const code = await run(async (services) => {
    if (!input || input.trim() === "") {
      throw new Error(
        "An input project is required. Use `git-focus --help` for usage."
      );
    }
    await services.git.ensureClean(options.repo, options.force);
    const request = createFocusRequest(
      input,
      parseProjectInputKind(options.type),
      !options.withoutDev
    );
    const selection = await services.planner.plan(request);
    const plan = await services.git.plan(
      selection,
      request.fullInputPath,
      options.repo
    );
    printPlan(plan);
    await services.git.apply(plan, options.force);
    console.log(
      "Focused successfully. Run `git-focus full` before selecting another input."
    );
  });
  process.exitCode = code;
});
program.command("plan").description(
  "Print the dependency and repository focus plan without changing files."
).argument("<input>", "Project input to analyze, such as path/to/Cargo.toml.").action(async (input) => {
  const options = program.opts();
  const code = await run(async (services) => {
    const request = createFocusRequest(
      input,
      parseProjectInputKind(options.type),
      !options.withoutDev
    );
    const selection = await services.planner.plan(request);
    const plan = await services.git.plan(
      selection,
      request.fullInputPath,
      options.repo
    );
    printPlan(plan);
  });
  process.exitCode = code;
});
program.command("full").description("Restore full source visibility for the last focused repository.").action(async () => {
  const code = await run(async (services) => {
    await services.git.restoreFull(program.opts().repo);
    console.log(
      "Full source visibility restored. Build caches and ignored files were not cleaned."
    );
  });
  process.exitCode = code;
});
program.command("status").description("Show the active git-focus state.").action(async () => {
  const code = await run(async (services) => {
    const status = await services.git.getStatus(program.opts().repo);
    console.log(status.isFocused ? "Mode: focused" : "Mode: full");
    console.log(`Repository: ${status.primaryRepositoryRoot}`);
    if (status.isFocused) {
      console.log(`Input: ${status.inputPath}`);
      console.log(`Input type: ${status.inputKind}`);
      for (const item of status.repositories) {
        console.log(`  ${item.repositoryRoot}`);
        const whitelisted = new Set(item.whitelistedPaths ?? []);
        for (const included of item.includedPaths) {
          const source = whitelisted.has(included) ? " [whitelist]" : "";
          console.log(`    ${included}${source}`);
        }
      }
    }
  });
  process.exitCode = code;
});
var whitelistCommand = program.command("whitelist").description("Manage repository paths preserved during focus.");
whitelistCommand.command("show").description("Print the repository whitelist in .gitignore format.").action(async () => {
  const code = await run(async (services) => {
    process.stdout.write(await services.whitelist.read(program.opts().repo));
  });
  process.exitCode = code;
});
whitelistCommand.command("add").description("Add an exact pattern to the repository whitelist.").argument("<pattern>", "A .gitignore-style pattern.").action(async (pattern) => {
  const code = await run(async (services) => {
    const added = await services.whitelist.add(program.opts().repo, pattern);
    console.log(added ? `Added: ${pattern}` : `Already present: ${pattern}`);
  });
  process.exitCode = code;
});
whitelistCommand.command("remove").description("Remove an exact pattern from the repository whitelist.").argument("<pattern>", "The exact pattern to remove.").action(async (pattern) => {
  const code = await run(async (services) => {
    const removed = await services.whitelist.remove(
      program.opts().repo,
      pattern
    );
    console.log(removed ? `Removed: ${pattern}` : `Not present: ${pattern}`);
  });
  process.exitCode = code;
});
whitelistCommand.command("match").description("Test whether a repository-relative path is whitelisted.").argument("<path>", "Repository-relative or absolute path to test.").action(async (candidatePath) => {
  let matched = false;
  const code = await run(async (services) => {
    const result = await services.whitelist.match(
      program.opts().repo,
      candidatePath
    );
    matched = result.matched;
    console.log(
      `${matched ? "WHITELISTED" : "NOT WHITELISTED"}: ${result.relativePath}`
    );
  });
  process.exitCode = code !== 0 ? code : matched ? 0 : 1;
});
program.command("install-skill").description("Install the git-focus Agent Skill for the current user.").action(async () => {
  const code = await run(async () => {
    const target = await installGitFocusSkill();
    console.log(`Installed git-focus Agent Skill to ${target}`);
  });
  process.exitCode = code;
});
await program.parseAsync(process.argv);
//# sourceMappingURL=cli.js.map