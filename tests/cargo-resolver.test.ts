import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CargoProjectInputResolver } from "../src/inputs/cargo/cargo-resolver.js";
import { ProjectInputResolverRegistry } from "../src/inputs/registry.js";
import { createFocusRequest } from "../src/inputs/types.js";
import { FocusPlanner } from "../src/planning/focus-planner.js";
import {
  TemporaryDirectory,
  createDirectoryLink,
  write,
} from "./helpers.js";

const temps: TemporaryDirectory[] = [];

afterEach(() => {
  while (temps.length > 0) {
    temps.pop()!.dispose();
  }
});

function temp(): TemporaryDirectory {
  const directory = new TemporaryDirectory();
  temps.push(directory);
  return directory;
}

function writePackage(root: string, name: string): void {
  write(
    root,
    `${name}/Cargo.toml`,
    `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"
`,
  );
  write(root, `${name}/src/lib.rs`, "pub fn marker() {}\n");
}

describe("CargoProjectInputResolver", () => {
  it("resolves runtime, build, and development path dependencies", async () => {
    const temporary = temp();
    write(
      temporary.path,
      "Cargo.toml",
      `[workspace]
resolver = "2"
members = ["app", "runtime", "build-helper", "dev-helper"]
`,
    );
    write(
      temporary.path,
      "app/Cargo.toml",
      `[package]
name = "app"
version = "0.1.0"
edition = "2021"

[lib]
path = "../shared/app.rs"

[dependencies]
runtime = { path = "../runtime" }

[build-dependencies]
build-helper = { path = "../build-helper" }

[dev-dependencies]
dev-helper = { path = "../dev-helper" }
`,
    );
    write(temporary.path, "shared/app.rs", "pub fn app() {}\n");
    write(temporary.path, ".cargo/config.toml", "[build]\nincremental = true\n");
    writePackage(temporary.path, "runtime");
    writePackage(temporary.path, "build-helper");
    writePackage(temporary.path, "dev-helper");

    const resolver = new CargoProjectInputResolver();
    const manifest = path.join(temporary.path, "app", "Cargo.toml");
    const graph = await resolver.resolve(createFocusRequest(manifest, "cargo"));
    const planner = new FocusPlanner(
      new ProjectInputResolverRegistry([resolver]),
    );
    const selection = await planner.plan(createFocusRequest(manifest, "cargo"));

    expect(graph.nodes.get(graph.rootId)?.name).toBe("app");
    const rootSourceDirectories = graph.nodes
      .get(graph.rootId)!
      .sourceDirectories.map((item) => path.resolve(item).toLowerCase());
    expect(rootSourceDirectories).toContain(
      path.resolve(temporary.path, "shared").toLowerCase(),
    );
    expect(rootSourceDirectories).toContain(
      path.resolve(temporary.path, ".cargo").toLowerCase(),
    );
    expect(selection.projects.map((project) => project.name)).toEqual([
      "app",
      "build-helper",
      "dev-helper",
      "runtime",
    ]);
  });

  it("preserves flat alias and physical source directories", async () => {
    const temporary = temp();
    write(
      temporary.path,
      "Cargo.toml",
      `[workspace]
resolver = "2"
members = ["flat-app"]
`,
    );
    writePackage(temporary.path, "physical-app");
    const physicalDirectory = path.join(temporary.path, "physical-app");
    const aliasDirectory = path.join(temporary.path, "flat-app");
    createDirectoryLink(aliasDirectory, physicalDirectory);

    const resolver = new CargoProjectInputResolver();
    const graph = await resolver.resolve(
      createFocusRequest(path.join(aliasDirectory, "Cargo.toml"), "cargo"),
    );
    const root = graph.nodes.get(graph.rootId)!;

    const normalized = root.sourceDirectories.map((item) =>
      path.resolve(item).toLowerCase(),
    );
    expect(normalized).toContain(path.resolve(aliasDirectory).toLowerCase());
    expect(normalized).toContain(path.resolve(physicalDirectory).toLowerCase());
  });
});
