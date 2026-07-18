import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installGitFocusSkill } from "../src/skill-installer.js";
import { TemporaryDirectory } from "./helpers.js";

describe("installGitFocusSkill", () => {
  it("copies the packaged skill into the user Agent Skills directory", async () => {
    const temporary = new TemporaryDirectory();
    try {
      const target = await installGitFocusSkill({
        userHome: temporary.path,
      });
      expect(target).toBe(
        path.join(temporary.path, ".agents", "skills", "git-focus"),
      );
      const skill = await fs.readFile(path.join(target, "SKILL.md"), "utf8");
      expect(skill).toContain("npm install -g <path-to-git-focus-repository>");
    } finally {
      temporary.dispose();
    }
  });
});
