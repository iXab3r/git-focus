#!/usr/bin/env node
import { Command, Option } from "commander";
import { installGitFocusSkill } from "./skill-installer.js";
import { CargoProjectInputResolver } from "./inputs/cargo/cargo-resolver.js";
import { ProjectInputResolverRegistry } from "./inputs/registry.js";
import {
  createFocusRequest,
  parseProjectInputKind,
} from "./inputs/types.js";
import { FocusPlanner } from "./planning/focus-planner.js";
import { GitFocusService } from "./git/git-focus-service.js";
import type { GitSparsePlan } from "./git/types.js";

function createServices() {
  const resolvers = [new CargoProjectInputResolver()];
  return {
    planner: new FocusPlanner(new ProjectInputResolverRegistry(resolvers)),
    git: new GitFocusService(),
  };
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
    for (const included of repository.includedPaths) {
      console.log(`    ${included}`);
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
      const plan = services.git.plan(
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
  .option("--type <type>", "Input adapter type. Defaults to auto detection.", "auto")
  .option("--without-dev", "Exclude development-only local dependencies.", false)
  .option(
    "--repo <path>",
    "Primary repository boundary. Defaults to the repository containing the current directory.",
    process.cwd(),
  )
  .action(async (input: string, options) => {
    const code = await run(async (services) => {
      const request = createFocusRequest(
        input,
        parseProjectInputKind(options.type),
        !options.withoutDev,
      );
      const selection = await services.planner.plan(request);
      const plan = services.git.plan(
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
  .option(
    "--repo <path>",
    "Repository path. Defaults to the current directory.",
    process.cwd(),
  )
  .action(async (options) => {
    const code = await run(async (services) => {
      await services.git.restoreFull(options.repo);
      console.log(
        "Full source visibility restored. Build caches and ignored files were not cleaned.",
      );
    });
    process.exitCode = code;
  });

program
  .command("status")
  .description("Show the active git-focus state.")
  .option(
    "--repo <path>",
    "Repository path. Defaults to the current directory.",
    process.cwd(),
  )
  .action(async (options) => {
    const code = await run(async (services) => {
      const status = await services.git.getStatus(options.repo);
      console.log(status.isFocused ? "Mode: focused" : "Mode: full");
      console.log(`Repository: ${status.primaryRepositoryRoot}`);
      if (status.isFocused) {
        console.log(`Input: ${status.inputPath}`);
        console.log(`Input type: ${status.inputKind}`);
        for (const item of status.repositories) {
          console.log(`  ${item.repositoryRoot}`);
          for (const included of item.includedPaths) {
            console.log(`    ${included}`);
          }
        }
      }
    });
    process.exitCode = code;
  });

program
  .command("install-skill")
  .description("Install the git-focus Agent Skill for the current user.")
  .addOption(
    new Option(
      "--automatic",
      "Install only when invoked by a global npm lifecycle.",
    ).hideHelp(),
  )
  .action(async (options) => {
    const code = await run(async () => {
      if (process.env.GIT_FOCUS_SKIP_SKILL_INSTALL === "1") {
        return;
      }
      const globalInstall = ["1", "true"].includes(
        process.env.npm_config_global?.toLowerCase() ?? "",
      );
      if (options.automatic && !globalInstall) {
        return;
      }
      const target = await installGitFocusSkill();
      console.log(`Installed git-focus Agent Skill to ${target}`);
    });
    process.exitCode = code;
  });

await program.parseAsync(process.argv);
