import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitCommandRunner } from "../src/git/git-runner.js";

describe("GitCommandRunner", () => {
  it("reports an actionable error when Git cannot be started", async () => {
    const runner = new GitCommandRunner("git-focus-command-that-does-not-exist");
    await expect(
      runner.run(
        path.resolve("."),
        ["status"],
      ),
    ).rejects.toThrow(/git status (?:could not be started|exited with code)/);
  });
});
