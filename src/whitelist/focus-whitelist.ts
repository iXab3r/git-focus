import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { GitCommandRunner } from "../git/git-runner.js";
import {
  findRepositoryRootLexically,
  fullPath,
  isInside,
  normalizeGitPath,
} from "../paths.js";

export const FOCUS_WHITELIST_FILE = ".gitignore-focus-whitelist";

export interface WhitelistMatch {
  repositoryRoot: string;
  relativePath: string;
  matched: boolean;
}

export class FocusWhitelist {
  constructor(private readonly git = new GitCommandRunner()) {}

  repositoryRoot(repositoryPath: string): string {
    return findRepositoryRootLexically(fullPath(repositoryPath));
  }

  filePath(repositoryPath: string): string {
    return path.join(this.repositoryRoot(repositoryPath), FOCUS_WHITELIST_FILE);
  }

  async read(repositoryPath: string): Promise<string> {
    try {
      return await fs.readFile(this.filePath(repositoryPath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  async add(repositoryPath: string, pattern: string): Promise<boolean> {
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

  async remove(repositoryPath: string, pattern: string): Promise<boolean> {
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

  async match(
    repositoryPath: string,
    candidatePath: string,
  ): Promise<WhitelistMatch> {
    const repositoryRoot = this.repositoryRoot(repositoryPath);
    const relativePath = normalizeCandidate(repositoryRoot, candidatePath);
    const matcher = await this.matcher(repositoryRoot);
    let matched = matcher.ignores(relativePath);
    if (!matched) {
      try {
        const stats = await fs.stat(path.join(repositoryRoot, relativePath));
        if (stats.isDirectory()) {
          matched = matcher.ignores(`${relativePath}/`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    return { repositoryRoot, relativePath, matched };
  }

  async matchedTrackedDirectories(repositoryPath: string): Promise<string[]> {
    const repositoryRoot = this.repositoryRoot(repositoryPath);
    const matcher = await this.matcher(repositoryRoot);
    const tracked = await this.git.run(repositoryRoot, ["ls-files", "-z"]);
    const directories = new Set<string>();

    for (const entry of tracked.split("\0")) {
      if (!entry) {
        continue;
      }
      const fullEntry = path.join(repositoryRoot, entry);
      let isDirectory = false;
      try {
        isDirectory = (await fs.stat(fullEntry)).isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      if (
        !matcher.ignores(entry) &&
        !(isDirectory && matcher.ignores(`${entry}/`))
      ) {
        continue;
      }
      let relativeDirectory = normalizeGitPath(path.dirname(entry));
      if (isDirectory) {
        relativeDirectory = normalizeGitPath(entry);
      }
      if (relativeDirectory !== ".") {
        directories.add(relativeDirectory);
      }
    }

    return minimizeDirectories([...directories]);
  }

  private async matcher(repositoryPath: string): Promise<Ignore> {
    return ignore().add(await this.read(repositoryPath));
  }

  private async write(repositoryPath: string, lines: string[]): Promise<void> {
    const filePath = this.filePath(repositoryPath);
    const contents = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    await fs.writeFile(filePath, contents, "utf8");
  }
}

function normalizeCandidate(
  repositoryRoot: string,
  candidatePath: string,
): string {
  const fullCandidate = path.isAbsolute(candidatePath)
    ? fullPath(candidatePath)
    : fullPath(path.join(repositoryRoot, candidatePath));
  if (!isInside(repositoryRoot, fullCandidate)) {
    throw new Error(
      `Path \`${fullCandidate}\` is outside repository \`${repositoryRoot}\`.`,
    );
  }
  const relative = normalizeGitPath(
    path.relative(repositoryRoot, fullCandidate),
  );
  if (relative === "") {
    throw new Error(
      "A repository-relative path is required for whitelist matching.",
    );
  }
  return relative;
}

function splitLines(contents: string): string[] {
  if (contents === "") {
    return [];
  }
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function validatePattern(pattern: string): void {
  if (pattern.trim() === "") {
    throw new Error("Whitelist pattern cannot be empty.");
  }
  ignore().add(pattern);
}

function minimizeDirectories(directories: string[]): string[] {
  const ordered = directories.sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  });
  const result: string[] = [];
  for (const directory of ordered) {
    if (
      !result.some(
        (parent) =>
          directory === parent || directory.startsWith(`${parent}/`),
      )
    ) {
      result.push(directory);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}
