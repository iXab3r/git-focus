import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitFocusService } from "../src/git/git-focus-service.js";
import type { FocusSelection } from "../src/inputs/types.js";
import {
  TemporaryDirectory,
  runGit,
  write,
} from "./helpers.js";

const temps: TemporaryDirectory[] = [];

afterEach(() => {
  while (temps.length > 0) {
    temps.pop()!.dispose();
  }
});

function createRepository(): TemporaryDirectory {
  const temporary = new TemporaryDirectory();
  temps.push(temporary);
  write(temporary.path, ".gitignore", "target/\n");
  write(temporary.path, "src/App/Cargo.toml", "[package]\nname='app'\nversion='0.1.0'\n");
  write(temporary.path, "src/App/source.txt", "app\n");
  write(temporary.path, "src/Lib/Cargo.toml", "[package]\nname='lib'\nversion='0.1.0'\n");
  write(temporary.path, "src/Lib/source.txt", "lib\n");
  write(temporary.path, "src/Other/source.txt", "other\n");
  write(temporary.path, "target/cache.bin", "cache\n");
  runGit(temporary.path, "init");
  runGit(temporary.path, "config", "user.name", "Git Focus Tests");
  runGit(temporary.path, "config", "user.email", "git-focus@example.invalid");
  runGit(temporary.path, "add", ".");
  runGit(temporary.path, "commit", "-m", "fixture");
  return temporary;
}

function createSelection(root: string): FocusSelection {
  const appManifest = path.join(root, "src", "App", "Cargo.toml");
  const libManifest = path.join(root, "src", "Lib", "Cargo.toml");
  const app = {
    id: "app",
    name: "app",
    manifestPath: appManifest,
    sourceDirectories: [path.dirname(appManifest)],
    dependencies: [{ targetId: "lib", kind: "runtime" as const }],
  };
  const library = {
    id: "lib",
    name: "lib",
    manifestPath: libManifest,
    sourceDirectories: [path.dirname(libManifest)],
    dependencies: [],
  };
  return {
    inputKind: "cargo",
    root: app,
    projects: [app, library],
  };
}

describe("GitFocusService", () => {
  it("focus and full round trip preserve ignored build cache", async () => {
    const temporary = createRepository();
    const service = new GitFocusService();
    const selection = createSelection(temporary.path);
    const input = path.join(temporary.path, "src", "App", "Cargo.toml");
    write(temporary.path, "local-notes.txt", "untracked\n");

    const plan = service.plan(selection, input, temporary.path);
    await service.apply(plan, true);

    expect(fs.existsSync(path.join(temporary.path, "src", "Other"))).toBe(false);
    expect(fs.existsSync(path.join(temporary.path, "target", "cache.bin"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(temporary.path, "local-notes.txt"))).toBe(
      true,
    );
    const focusedStatus = await service.getStatus(temporary.path);
    expect(focusedStatus.isFocused).toBe(true);
    expect(focusedStatus.inputKind).toBe("cargo");

    await service.restoreFull(temporary.path);

    expect(fs.existsSync(path.join(temporary.path, "src", "Other"))).toBe(true);
    expect(fs.existsSync(path.join(temporary.path, "target", "cache.bin"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(temporary.path, "local-notes.txt"))).toBe(
      true,
    );
    expect((await service.getStatus(temporary.path)).isFocused).toBe(false);
  });

  it("refuses dirty tracked paths by default", async () => {
    const temporary = createRepository();
    fs.appendFileSync(
      path.join(temporary.path, "src", "Other", "source.txt"),
      "dirty\n",
    );
    const service = new GitFocusService();
    const input = path.join(temporary.path, "src", "App", "Cargo.toml");
    const plan = service.plan(
      createSelection(temporary.path),
      input,
      temporary.path,
    );

    await expect(service.apply(plan, false)).rejects.toThrow(/src\/Other\/source\.txt/);
    await expect(service.apply(plan, false)).rejects.toThrow(/--force/);
    expect(fs.existsSync(path.join(temporary.path, "src", "Other"))).toBe(true);
  });

  it("refuses untracked paths by default", async () => {
    const temporary = createRepository();
    write(temporary.path, "local-notes.txt", "untracked\n");
    const service = new GitFocusService();
    const input = path.join(temporary.path, "src", "App", "Cargo.toml");
    const plan = service.plan(
      createSelection(temporary.path),
      input,
      temporary.path,
    );

    await expect(service.apply(plan, false)).rejects.toThrow(/local-notes\.txt/);
    await expect(service.apply(plan, false)).rejects.toThrow(/--force/);
  });

  it("refuses staged paths by default", async () => {
    const temporary = createRepository();
    write(temporary.path, "staged-notes.txt", "staged\n");
    runGit(temporary.path, "add", "staged-notes.txt");
    const service = new GitFocusService();
    const input = path.join(temporary.path, "src", "App", "Cargo.toml");
    const plan = service.plan(
      createSelection(temporary.path),
      input,
      temporary.path,
    );

    await expect(service.apply(plan, false)).rejects.toThrow(/staged-notes\.txt/);
    await expect(service.apply(plan, false)).rejects.toThrow(/--force/);
  });

  it("plan uses explicit outer repository and includes nested repository chain", async () => {
    const temporary = createRepository();
    const nestedRoot = path.join(temporary.path, "modules", "Nested");
    write(
      nestedRoot,
      "src/App/Cargo.toml",
      "[package]\nname='nested-app'\nversion='0.1.0'\n",
    );
    write(nestedRoot, "src/App/source.txt", "nested\n");
    runGit(nestedRoot, "init");
    const service = new GitFocusService();
    const input = path.join(nestedRoot, "src", "App", "Cargo.toml");
    const app = {
      id: "nested-app",
      name: "nested-app",
      manifestPath: input,
      sourceDirectories: [path.dirname(input)],
      dependencies: [],
    };

    const plan = service.plan(
      { inputKind: "cargo", root: app, projects: [app] },
      input,
      temporary.path,
    );

    expect(path.resolve(plan.primaryRepositoryRoot)).toBe(
      path.resolve(temporary.path),
    );
    expect(plan.repositories).toHaveLength(2);
    expect(plan.repositories[0]!.includedPaths).toEqual(["modules/Nested"]);
    expect(plan.repositories[1]!.includedPaths).toEqual(["src/App"]);
  });

  it("refuses to overwrite sparse state in a nested repository", async () => {
    const temporary = createRepository();
    const nestedRoot = path.join(temporary.path, "modules", "Nested");
    write(
      nestedRoot,
      "src/App/Cargo.toml",
      "[package]\nname='nested-app'\nversion='0.1.0'\n",
    );
    write(nestedRoot, "src/App/source.txt", "nested\n");
    runGit(nestedRoot, "init");
    runGit(nestedRoot, "config", "core.sparseCheckout", "true");
    const service = new GitFocusService();
    const input = path.join(nestedRoot, "src", "App", "Cargo.toml");
    const app = {
      id: "nested-app",
      name: "nested-app",
      manifestPath: input,
      sourceDirectories: [path.dirname(input)],
      dependencies: [],
    };

    const plan = service.plan(
      { inputKind: "cargo", root: app, projects: [app] },
      input,
      temporary.path,
    );

    await expect(service.apply(plan, true)).rejects.toThrow(
      /Nested.*already uses sparse checkout/,
    );
    expect(fs.existsSync(path.join(temporary.path, "src", "Other"))).toBe(true);
  });
});
