import path from "node:path";
import { isInside, normalizeGitPath } from "../paths.js";

export interface PathRule { path: string; include: boolean }
export interface PathFocusPlan {
  repositoryRoot: string;
  rules: PathRule[];
  previousRules: PathRule[];
  excludedFiles: string[];
}

export function normalizeFocusPath(root: string, value: string, tracked: string[]): string {
  const full = path.resolve(root, value);
  const relative = normalizeGitPath(path.relative(root, full));
  if (!isInside(root, full) || !relative || relative === ".git" || relative.startsWith(".git/")) {
    throw new Error(`Expected a file or directory inside the repository: ${value}`);
  }
  if (/[\r\n\0]/u.test(relative)) throw new Error("Paths cannot contain line breaks or NUL.");
  // Hidden paths are resolved against Git, independently of filesystem presence.
  const key = process.platform === "win32" ? relative.toLowerCase() : relative;
  const existing = tracked.find(p => {
    const candidate = process.platform === "win32" ? p.toLowerCase() : p;
    return candidate === key || candidate.startsWith(key + "/");
  });
  return existing ? existing.slice(0, relative.length) : relative;
}

export function updatePathRules(previous: PathRule[], paths: string[], include: boolean): PathRule[] {
  let rules = [...previous];
  for (const candidate of paths) {
    // A later parent action supersedes its earlier nested exceptions.
    rules = rules.filter(r => r.path !== candidate && !r.path.startsWith(candidate + "/"));
    rules.push({ path: candidate, include });
  }
  return rules;
}

export function pathIsIncluded(candidate: string, rules: PathRule[]): boolean {
  let included = true;
  for (const rule of rules) {
    if (candidate === rule.path || candidate.startsWith(rule.path + "/")) included = rule.include;
  }
  return included;
}

function literal(value: string): string {
  return value.replace(/[\\*?[\] ]/gu, "\\$&");
}

export function pathSparsePatterns(rules: PathRule[]): string {
  const prefixes = new Set<string>();
  for (const rule of rules) {
    const parts = rule.path.split("/");
    for (let i = 1; i <= parts.length; i++) prefixes.add(parts.slice(0, i).join("/"));
  }
  const children = (parent: string) => [...prefixes].filter(p => path.posix.dirname(p) === (parent || ".")).sort();
  const visible = (prefix: string): boolean => pathIsIncluded(prefix, rules) || children(prefix).some(visible);
  const patterns = ["/*"];
  const visit = (prefix: string, parentIncluded: boolean) => {
    const included = pathIsIncluded(prefix, rules);
    if (!included && !visible(prefix)) {
      if (parentIncluded) patterns.push(`!/${literal(prefix)}`);
      return;
    }
    if (!included) {
      patterns.push(`/${literal(prefix)}`, `!/${literal(prefix)}/*`);
    } else if (!parentIncluded) patterns.push(`/${literal(prefix)}`);
    for (const child of children(prefix)) visit(child, included);
  };
  for (const child of children("")) visit(child, true);
  return patterns.join("\n") + "\n";
}
