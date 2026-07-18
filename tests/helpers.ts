import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class TemporaryDirectory {
  readonly path: string;

  constructor() {
    this.path = fs.mkdtempSync(path.join(os.tmpdir(), "git-focus-tests-"));
  }

  dispose(): void {
    fs.rmSync(this.path, { recursive: true, force: true });
  }
}

export function write(root: string, relativePath: string, contents: string): void {
  const full = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

export function runGit(workingDirectory: string, ...arguments_: string[]): void {
  execFileSync("git", arguments_, {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function createDirectoryLink(linkPath: string, targetPath: string): void {
  if (process.platform !== "win32") {
    fs.symlinkSync(targetPath, linkPath, "dir");
    return;
  }

  execFileSync("cmd.exe", ["/d", "/c", "mklink", "/J", linkPath, targetPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
