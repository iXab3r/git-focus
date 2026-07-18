import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectInputResolverRegistry } from "../src/inputs/registry.js";
import {
  createFocusRequest,
  type FocusRequest,
  type ProjectGraph,
  type ProjectInputResolver,
  type ProjectNode,
} from "../src/inputs/types.js";
import { FocusPlanner } from "../src/planning/focus-planner.js";

describe("FocusPlanner", () => {
  it("keeps input types replaceable and filters development edges", async () => {
    const cargo = new FakeResolver("cargo", true);
    const msbuild = new FakeResolver("msbuild", false);
    const registry = new ProjectInputResolverRegistry([cargo, msbuild]);
    const planner = new FocusPlanner(registry);

    const withDevelopment = await planner.plan(
      createFocusRequest("Cargo.toml", "auto", true),
    );
    const withoutDevelopment = await planner.plan(
      createFocusRequest("Cargo.toml", "cargo", false),
    );

    expect(withDevelopment.projects.map((project) => project.name)).toEqual([
      "app",
      "dev",
      "runtime",
    ]);
    expect(withoutDevelopment.projects.map((project) => project.name)).toEqual([
      "app",
      "runtime",
    ]);
    expect(cargo.resolveCount).toBe(2);
    expect(msbuild.resolveCount).toBe(0);
  });
});

class FakeResolver implements ProjectInputResolver {
  resolveCount = 0;

  constructor(
    readonly kind: string,
    private readonly canResolveFlag: boolean,
  ) {}

  canResolve(_request: FocusRequest): boolean {
    return this.canResolveFlag;
  }

  async resolve(_request: FocusRequest): Promise<ProjectGraph> {
    this.resolveCount += 1;
    const root = path.resolve("Cargo.toml");
    const directory = path.dirname(root);
    const nodes = new Map<string, ProjectNode>([
      [
        "app",
        {
          id: "app",
          name: "app",
          manifestPath: root,
          sourceDirectories: [directory],
          dependencies: [
            { targetId: "runtime", kind: "runtime" },
            { targetId: "dev", kind: "development" },
          ],
        },
      ],
      [
        "runtime",
        {
          id: "runtime",
          name: "runtime",
          manifestPath: root,
          sourceDirectories: [directory],
          dependencies: [],
        },
      ],
      [
        "dev",
        {
          id: "dev",
          name: "dev",
          manifestPath: root,
          sourceDirectories: [directory],
          dependencies: [],
        },
      ],
    ]);
    return { inputKind: this.kind, rootId: "app", nodes };
  }
}
