import { execa } from "execa";
import { formatProcessFailure } from "../process-error.js";

export class GitCommandRunner {
  constructor(private readonly executable = "git") {}

  async run(repositoryRoot: string, arguments_: string[], input?: string): Promise<string> {
    const result = await execa(
      this.executable,
      ["-C", repositoryRoot, ...arguments_],
      {
        reject: false,
        encoding: "utf8",
        ...(input === undefined ? {} : { input }),
      },
    );
    if (result.exitCode !== 0) {
      const command = `git ${arguments_.join(" ")}`;
      throw new Error(
        `${formatProcessFailure(command, result)}\nRepository: ${repositoryRoot}`,
      );
    }
    return result.stdout ?? "";
  }

  async tryRun(
    repositoryRoot: string,
    arguments_: string[],
  ): Promise<{ exitCode: number; stdout: string }> {
    const result = await execa(
      this.executable,
      ["-C", repositoryRoot, ...arguments_],
      {
        reject: false,
        encoding: "utf8",
      },
    );
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout ?? "" };
  }
}
