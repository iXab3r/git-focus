import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOCUS_WHITELIST_FILE,
  FocusWhitelist,
} from "../src/whitelist/focus-whitelist.js";
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
  write(temporary.path, "docs/public.md", "public\n");
  write(temporary.path, "docs/private.md", "private\n");
  write(temporary.path, "src/main.ts", "main\n");
  write(temporary.path, ".gitignore", "target/\n");
  write(temporary.path, "target/cache.bin", "cache\n");
  write(
    temporary.path,
    FOCUS_WHITELIST_FILE,
    [
      "# Paths preserved while focused.",
      "/target/",
      "/docs/*.md",
      "!/docs/private.md",
      "",
    ].join("\n"),
  );
  runGit(temporary.path, "init");
  runGit(temporary.path, "config", "user.name", "Git Focus Tests");
  runGit(temporary.path, "config", "user.email", "git-focus@example.invalid");
  runGit(temporary.path, "add", ".");
  runGit(temporary.path, "commit", "-m", "fixture");
  return temporary;
}

describe("FocusWhitelist", () => {
  it("matches gitignore syntax and resolves tracked directories", async () => {
    const temporary = createRepository();
    const whitelist = new FocusWhitelist();

    await expect(
      whitelist.match(temporary.path, "target/cache.bin"),
    ).resolves.toMatchObject({ matched: true, relativePath: "target/cache.bin" });
    await expect(
      whitelist.match(temporary.path, "docs/public.md"),
    ).resolves.toMatchObject({ matched: true });
    await expect(
      whitelist.match(temporary.path, "docs/private.md"),
    ).resolves.toMatchObject({ matched: false });
    await expect(
      whitelist.match(temporary.path, "src/main.ts"),
    ).resolves.toMatchObject({ matched: false });
    await expect(
      whitelist.matchedTrackedDirectories(temporary.path),
    ).resolves.toEqual(["docs"]);
  });

  it("adds and removes exact patterns while retaining direct edits", async () => {
    const temporary = createRepository();
    const whitelist = new FocusWhitelist();

    await expect(whitelist.add(temporary.path, "/generated/")).resolves.toBe(
      true,
    );
    await expect(whitelist.add(temporary.path, "/generated/")).resolves.toBe(
      false,
    );
    expect(await whitelist.read(temporary.path)).toContain(
      "# Paths preserved while focused.\n",
    );
    await expect(
      whitelist.match(temporary.path, "generated/output.txt"),
    ).resolves.toMatchObject({ matched: true });

    await expect(
      whitelist.remove(temporary.path, "/generated/"),
    ).resolves.toBe(true);
    await expect(
      whitelist.remove(temporary.path, "/generated/"),
    ).resolves.toBe(false);
    expect(await whitelist.read(temporary.path)).not.toContain("/generated/");
  });

  it("rejects match paths outside the repository", async () => {
    const temporary = createRepository();
    const outside = path.resolve(temporary.path, "..", "outside.txt");

    await expect(
      new FocusWhitelist().match(temporary.path, outside),
    ).rejects.toThrow(/outside repository/);
  });
});
