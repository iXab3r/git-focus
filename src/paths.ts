import fs from "node:fs";
import path from "node:path";

export function fullPath(value: string): string {
  return path.resolve(value);
}

export function pathsEqual(left: string, right: string): boolean {
  const a = trimTrailingSeparators(fullPath(left));
  const b = trimTrailingSeparators(fullPath(right));
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(fullPath(root), fullPath(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function pathDepth(value: string): number {
  return fullPath(value).split(path.sep).filter(Boolean).length;
}

export function normalizeGitPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function resolveDirectoryLink(value: string): string {
  const resolved = fullPath(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function findNearestFile(
  startDirectory: string,
  fileName: string,
): string | undefined {
  let current = fullPath(startDirectory);
  for (;;) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function findRepositoryRootLexically(startPath: string): string {
  const start = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  let current = fullPath(start);
  for (;;) {
    const marker = path.join(current, ".git");
    if (fs.existsSync(marker)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`\`${startPath}\` is not inside a Git repository.`);
    }
    current = parent;
  }
}

function trimTrailingSeparators(value: string): string {
  if (value.length <= 1) {
    return value;
  }
  return value.replace(/[/\\]+$/, "");
}
