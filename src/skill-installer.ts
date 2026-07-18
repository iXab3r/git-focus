import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInstallOptions {
  packageRoot?: string;
  userHome?: string;
}

export async function installGitFocusSkill(
  options: SkillInstallOptions = {},
): Promise<string> {
  const packageRoot =
    options.packageRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const userHome =
    options.userHome ?? process.env.GIT_FOCUS_SKILL_HOME ?? os.homedir();
  const source = path.join(
    packageRoot,
    ".agents",
    "skills",
    "git-focus",
  );
  const target = path.join(userHome, ".agents", "skills", "git-focus");

  await fs.access(path.join(source, "SKILL.md"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
  return target;
}
