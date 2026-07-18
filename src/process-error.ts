export interface ProcessFailure {
  exitCode?: number | undefined;
  stderr?: unknown;
  shortMessage?: string | undefined;
}

export function formatProcessFailure(
  command: string,
  result: ProcessFailure,
): string {
  const stderr =
    typeof result.stderr === "string" ? result.stderr.trim() : "";
  const detail =
    stderr || result.shortMessage?.trim() || "No error output was provided.";
  const exit =
    typeof result.exitCode === "number"
      ? ` exited with code ${result.exitCode}`
      : " could not be started";
  return `${command}${exit}:\n${detail}`;
}
