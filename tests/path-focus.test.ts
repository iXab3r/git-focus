import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { GitFocusService } from "../src/git/git-focus-service.js";
import { GitCommandRunner } from "../src/git/git-runner.js";
import { FocusWhitelist, FOCUS_WHITELIST_FILE } from "../src/whitelist/focus-whitelist.js";
import { TemporaryDirectory, runGit, write } from "./helpers.js";

const temps: TemporaryDirectory[] = [];
afterEach(() => { while (temps.length) temps.pop()!.dispose(); });
function fixture() {
  const temp = new TemporaryDirectory(); temps.push(temp);
  for (const file of ["src/App/source.txt", "src/App/nested/file.txt", "src/Lib/source.txt", "src/root.txt", "README.md", ".agents/rules.md", "literal [x]/name !.txt"])
    write(temp.path, file, file + "\n");
  write(temp.path, ".gitignore", "target/\nbin/\n");
  write(temp.path, "target/cache.bin", "cache\n");
  runGit(temp.path, "init");
  runGit(temp.path, "config", "core.autocrlf", "false");
  runGit(temp.path, "config", "user.name", "Git Focus Tests");
  runGit(temp.path, "config", "user.email", "git-focus@example.invalid");
  runGit(temp.path, "add", "."); runGit(temp.path, "commit", "-m", "fixture");
  const git = new GitCommandRunner();
  const service = new GitFocusService(git, new FocusWhitelist(git, path.resolve(FOCUS_WHITELIST_FILE)));
  const exists = (p: string) => fs.existsSync(path.join(temp.path, p));
  const apply = async (include: boolean, ...paths: string[]) => service.applyPaths(await service.planPaths(temp.path, paths, include), false);
  return { temp, service, git, exists, apply };
}

describe("path selection", () => {
  it("physically excludes multiple directories while preserving siblings, root files and ignored cache", async () => {
    const f = fixture();
    expect(await f.apply(false, "src/App", "src/Lib")).toEqual([]);
    expect(f.exists("src/App")).toBe(false); expect(f.exists("src/Lib")).toBe(false);
    expect(f.exists("src/root.txt")).toBe(true); expect(f.exists("README.md")).toBe(true);
    expect(f.exists("target/cache.bin")).toBe(true);
    expect(await f.git.run(f.temp.path, ["status", "--porcelain"])).toBe("");
    await f.service.restoreFull(f.temp.path);
    expect(fs.readFileSync(path.join(f.temp.path, "src/App/source.txt"), "utf8")).toBe("src/App/source.txt\n");
    expect((await f.service.getStatus(f.temp.path)).isFocused).toBe(false);
  });

  it("restores nested exceptions without returning parent files or other excluded siblings", async () => {
    const f = fixture();
    await f.apply(false, "src");
    await f.apply(true, "src/App/nested");
    expect(f.exists("src/App/nested/file.txt")).toBe(true);
    expect(f.exists("src/App/source.txt")).toBe(false); expect(f.exists("src/root.txt")).toBe(false);
    await f.apply(true, "src/Lib");
    expect(f.exists("src/Lib/source.txt")).toBe(true); expect(f.exists("src/App/nested/file.txt")).toBe(true);
    await f.apply(false, "src");
    expect(f.exists("src")).toBe(false);
    expect((await f.service.getStatus(f.temp.path)).pathRules).toEqual([{ path: "src", include: false }]);
  });

  it("supports repeated actions and an exact file with spaces and pattern characters", async () => {
    const f = fixture();
    await f.apply(false, "literal [x]/name !.txt"); await f.apply(false, "literal [x]/name !.txt");
    expect(f.exists("literal [x]/name !.txt")).toBe(false);
    expect((await f.service.getStatus(f.temp.path)).pathRules).toHaveLength(1);
    await f.apply(true, "literal [x]/name !.txt"); await f.apply(true, "literal [x]/name !.txt");
    expect(f.exists("literal [x]/name !.txt")).toBe(true);
  });

  it("allows including a future directory and adding its first untracked file normally", async () => {
    const f = fixture(); await f.apply(false, "src");
    await f.apply(true, "src/NewResolver");
    write(f.temp.path, "src/NewResolver/new.cs", "new module\n");
    runGit(f.temp.path, "add", "src/NewResolver/new.cs");
    expect(await f.git.run(f.temp.path, ["diff", "--cached", "--name-only"])).toBe("src/NewResolver/new.cs");
    await f.service.restoreFull(f.temp.path);
    expect(f.exists("src/NewResolver/new.cs")).toBe(true); expect(f.exists("src/Lib/source.txt")).toBe(true);
  });

  it.each(["modified", "staged", "untracked"])("rejects %s work before changing sparse checkout", async kind => {
    const f = fixture();
    if (kind === "modified") fs.appendFileSync(path.join(f.temp.path, "src/App/source.txt"), "dirty\n");
    else { write(f.temp.path, "note.txt", "note\n"); if (kind === "staged") runGit(f.temp.path, "add", "note.txt"); }
    const plan = await f.service.planPaths(f.temp.path, ["src/App"], false);
    await expect(f.service.applyPaths(plan, false)).rejects.toThrow(/uncommitted changes/);
    expect(f.exists("src/App/nested/file.txt")).toBe(true);
    expect((await f.service.getStatus(f.temp.path)).isFocused).toBe(false);
  });

  it("force retains and reports changed, untracked and ignored files inside an excluded directory", async () => {
    const f = fixture(); fs.appendFileSync(path.join(f.temp.path, "src/App/source.txt"), "dirty\n");
    write(f.temp.path, "src/App/note.txt", "note\n"); write(f.temp.path, "src/App/bin/cache", "cache\n");
    const plan = await f.service.planPaths(f.temp.path, ["src/App"], false);
    const remaining = await f.service.applyPaths(plan, true);
    expect(remaining).toEqual(["src/App/bin/cache", "src/App/note.txt", "src/App/source.txt"]);
    expect(f.exists("src/App/nested/file.txt")).toBe(false);
    expect((await f.service.getStatus(f.temp.path)).remainingPaths).toEqual(remaining);
    await f.service.restoreFull(f.temp.path);
    expect(fs.readFileSync(path.join(f.temp.path, "src/App/source.txt"), "utf8")).toContain("dirty\n");
    expect(f.exists("src/App/bin/cache")).toBe(true);
  });

  it("rejects traversal, repository metadata and paths preserved by the whitelist", async () => {
    const f = fixture();
    for (const value of ["../outside", ".", ".git", ".git/config", "bad\npath"])
      await expect(f.service.planPaths(f.temp.path, [value], false)).rejects.toThrow();
    await expect(f.service.planPaths(f.temp.path, [".agents"], false)).rejects.toThrow(/preserved/);
    expect(f.exists(".agents/rules.md")).toBe(true);
  });

  it("dry-run CLI accepts several paths and writes neither state nor sparse patterns", () => {
    const f = fixture();
    const output = execFileSync(process.execPath, [path.resolve("dist/cli.js"), "exclude", "src/App", "src/Lib", "--repo", f.temp.path, "--dry-run"], { encoding: "utf8" });
    expect(output).toContain("Tracked files excluded: 3");
    expect(f.exists("src/App/source.txt")).toBe(true); expect(f.exists(".git/git-focus/state.json")).toBe(false);
    expect(f.exists(".git/info/sparse-checkout")).toBe(false);
  });
});
