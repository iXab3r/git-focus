#!/usr/bin/env node
import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { installGitFocusSkill } from "./skill-installer.js";
import { CargoProjectInputResolver } from "./inputs/cargo/cargo-resolver.js";
import { ProjectInputResolverRegistry } from "./inputs/registry.js";
import {
  createFocusRequest,
  parseProjectInputKind,
} from "./inputs/types.js";
import { FocusPlanner } from "./planning/focus-planner.js";
import { GitFocusService } from "./git/git-focus-service.js";
import { GitCommandRunner } from "./git/git-runner.js";
import type { GitSparsePlan } from "./git/types.js";
import {
  FocusWhitelist,
  type WhitelistFileScope,
} from "./whitelist/focus-whitelist.js";

const SHIPPED_USER_WHITELIST = fileURLToPath(
  new URL("../.gitignore-focus-whitelist", import.meta.url),
);

function createServices() {
  const resolvers = [new CargoProjectInputResolver()];
  const gitRunner = new GitCommandRunner();
  const whitelist = new FocusWhitelist(gitRunner, SHIPPED_USER_WHITELIST);
  return {
    planner: new FocusPlanner(new ProjectInputResolverRegistry(resolvers)),
    git: new GitFocusService(gitRunner, whitelist),
    whitelist,
  };
}

type WhitelistShowScope = WhitelistFileScope | "effective";

function parseWhitelistFileScope(value: string): WhitelistFileScope {
  if (value === "user" || value === "workspace") {
    return value;
  }
  throw new Error(
    `Unknown whitelist scope \`${value}\`. Available scopes: user, workspace.`,
  );
}

function parseWhitelistShowScope(value: string): WhitelistShowScope {
  if (value === "effective") {
    return value;
  }
  return parseWhitelistFileScope(value);
}

function printPlan(plan: GitSparsePlan): void {
  console.log(`Input type: ${plan.inputKind}`);
  console.log(`Root project: ${plan.rootProject.name}`);
  console.log(`Projects (${plan.projects.length}):`);
  for (const project of plan.projects) {
    console.log(`  ${project.name}  ${project.manifestPath}`);
  }

  console.log(`Repositories (${plan.repositories.length}):`);
  for (const repository of plan.repositories) {
    console.log(`  ${repository.repositoryRoot}`);
    if (repository.includeWholeRepository) {
      console.log("    <full repository>");
      continue;
    }
    const whitelisted = new Set(repository.whitelistedPaths ?? []);
    for (const included of repository.includedPaths) {
      const source = whitelisted.has(included) ? " [whitelist]" : "";
      console.log(`    ${included}${source}`);
    }
  }
}

async function run(
  operation: (services: ReturnType<typeof createServices>) => Promise<void>,
): Promise<number> {
  try {
    await operation(createServices());
    return 0;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Operation cancelled.");
      return 130;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const program = new Command();
program.configureHelp({ showGlobalOptions: true });
program
  .name("git-focus")
  .description(
    "Focus a Git monorepo to one project and its local dependency closure.",
  )
  .argument("[input]", "Project input to focus, such as path/to/Cargo.toml.")
  .option("--type <type>", "Input adapter type. Defaults to auto detection.", "auto")
  .option("--without-dev", "Exclude development-only local dependencies.", false)
  .option(
    "--force",
    "Allow focusing repositories that contain uncommitted changes.",
    false,
  )
  .option(
    "--repo <path>",
    "Primary repository boundary. Defaults to the repository containing the current directory.",
    process.cwd(),
  )
  .action(async (input: string | undefined, options) => {
    const code = await run(async (services) => {
      if (!input || input.trim() === "") {
        throw new Error(
          "An input project is required. Use `git-focus --help` for usage.",
        );
      }

      await services.git.ensureClean(options.repo, options.force);
      const request = createFocusRequest(
        input,
        parseProjectInputKind(options.type),
        !options.withoutDev,
      );
      const selection = await services.planner.plan(request);
      const plan = await services.git.plan(
        selection,
        request.fullInputPath,
        options.repo,
      );
      printPlan(plan);
      await services.git.apply(plan, options.force);
      console.log(
        "Focused successfully. Run `git-focus full` before selecting another input.",
      );
    });
    process.exitCode = code;
  });

program
  .command("plan")
  .description(
    "Print the dependency and repository focus plan without changing files.",
  )
  .argument("<input>", "Project input to analyze, such as path/to/Cargo.toml.")
  .action(async (input: string) => {
    const options = program.opts();
    const code = await run(async (services) => {
      const request = createFocusRequest(
        input,
        parseProjectInputKind(options.type),
        !options.withoutDev,
      );
      const selection = await services.planner.plan(request);
      const plan = await services.git.plan(
        selection,
        request.fullInputPath,
        options.repo,
      );
      printPlan(plan);
    });
    process.exitCode = code;
  });

program
  .command("full")
  .description("Restore full source visibility for the last focused repository.")
  .action(async () => {
    const code = await run(async (services) => {
      await services.git.restoreFull(program.opts().repo);
      console.log(
        "Full source visibility restored. Build caches and ignored files were not cleaned.",
      );
    });
    process.exitCode = code;
  });

program
  .command("status")
  .description("Show the active git-focus state.")
  .action(async () => {
    const code = await run(async (services) => {
      const status = await services.git.getStatus(program.opts().repo);
      console.log(status.isFocused ? "Mode: focused" : "Mode: full");
      console.log(`Repository: ${status.primaryRepositoryRoot}`);
      if (status.isFocused) {
        console.log(`Input: ${status.inputPath}`);
        console.log(`Input type: ${status.inputKind}`);
        for (const item of status.repositories) {
          console.log(`  ${item.repositoryRoot}`);
          const whitelisted = new Set(item.whitelistedPaths ?? []);
          for (const included of item.includedPaths) {
            const source = whitelisted.has(included) ? " [whitelist]" : "";
            console.log(`    ${included}${source}`);
          }
        }
      }
    });
    process.exitCode = code;
  });

const whitelistCommand = program
  .command("whitelist")
  .description("Manage repository paths preserved during focus.");

whitelistCommand
  .command("show")
  .description("Print the effective, user, or workspace whitelist.")
  .option(
    "--scope <scope>",
    "Whitelist scope: effective, user, or workspace.",
    "effective",
  )
  .action(async (options: { scope: string }) => {
    const code = await run(async (services) => {
      const scope = parseWhitelistShowScope(options.scope);
      if (scope !== "effective") {
        process.stdout.write(
          await services.whitelist.read(program.opts().repo, scope),
        );
        return;
      }

      for (const fileScope of ["user", "workspace"] as const) {
        const filePath = services.whitelist.filePath(
          program.opts().repo,
          fileScope,
        );
        console.log(`# ${fileScope} whitelist: ${filePath}`);
        const contents = await services.whitelist.read(
          program.opts().repo,
          fileScope,
        );
        if (contents !== "") {
          process.stdout.write(contents);
        }
        if (fileScope === "user") {
          console.log();
        }
      }
    });
    process.exitCode = code;
  });

whitelistCommand
  .command("add")
  .description("Add an exact pattern to the user or workspace whitelist.")
  .argument("<pattern>", "A .gitignore-style pattern.")
  .option(
    "--scope <scope>",
    "Whitelist file to edit: user or workspace.",
    "workspace",
  )
  .action(async (pattern: string, options: { scope: string }) => {
    const code = await run(async (services) => {
      const scope = parseWhitelistFileScope(options.scope);
      const added = await services.whitelist.add(
        program.opts().repo,
        pattern,
        scope,
      );
      const filePath = services.whitelist.filePath(program.opts().repo, scope);
      console.log(
        `${added ? "Added" : "Already present"} in ${scope} whitelist (${filePath}): ${pattern}`,
      );
    });
    process.exitCode = code;
  });

whitelistCommand
  .command("remove")
  .description("Remove an exact pattern from the user or workspace whitelist.")
  .argument("<pattern>", "The exact pattern to remove.")
  .option(
    "--scope <scope>",
    "Whitelist file to edit: user or workspace.",
    "workspace",
  )
  .action(async (pattern: string, options: { scope: string }) => {
    const code = await run(async (services) => {
      const scope = parseWhitelistFileScope(options.scope);
      const removed = await services.whitelist.remove(
        program.opts().repo,
        pattern,
        scope,
      );
      const filePath = services.whitelist.filePath(program.opts().repo, scope);
      console.log(
        `${removed ? "Removed" : "Not present"} in ${scope} whitelist (${filePath}): ${pattern}`,
      );
    });
    process.exitCode = code;
  });

whitelistCommand
  .command("match")
  .description("Test whether a repository-relative path is whitelisted.")
  .argument("<path>", "Repository-relative or absolute path to test.")
  .action(async (candidatePath: string) => {
    let matched = false;
    const code = await run(async (services) => {
      const result = await services.whitelist.match(
        program.opts().repo,
        candidatePath,
      );
      matched = result.matched;
      console.log(
        `${matched ? "WHITELISTED" : "NOT WHITELISTED"}: ${result.relativePath}`,
      );
    });
    process.exitCode = code !== 0 ? code : matched ? 0 : 1;
  });

program
  .command("install-skill")
  .description("Install the git-focus Agent Skill for the current user.")
  .action(async () => {
    const code = await run(async () => {
      const target = await installGitFocusSkill();
      console.log(`Installed git-focus Agent Skill to ${target}`);
    });
    process.exitCode = code;
  });

await program.parseAsync(process.argv);
