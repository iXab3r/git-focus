import { ProjectInputResolverRegistry } from "../inputs/registry.js";
import type {
  FocusRequest,
  FocusSelection,
  ProjectNode,
} from "../inputs/types.js";

export class FocusPlanner {
  constructor(private readonly registry: ProjectInputResolverRegistry) {}

  async plan(request: FocusRequest): Promise<FocusSelection> {
    const resolver = this.registry.resolve(request);
    const graph = await resolver.resolve(request);
    const root = graph.nodes.get(graph.rootId);
    if (!root) {
      throw new Error(
        `Input resolver \`${resolver.kind}\` returned an unknown root node.`,
      );
    }

    const selected = new Set<string>();
    const pending = [graph.rootId];

    while (pending.length > 0) {
      const nodeId = pending.shift()!;
      if (selected.has(nodeId)) {
        continue;
      }
      selected.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (!node) {
        throw new Error(
          `Input resolver \`${resolver.kind}\` returned dependency \`${nodeId}\` without a project node.`,
        );
      }

      for (const dependency of node.dependencies) {
        if (
          dependency.kind === "development" &&
          !request.includeDevelopmentDependencies
        ) {
          continue;
        }
        pending.push(dependency.targetId);
      }
    }

    const projects = [...selected]
      .map((id) => graph.nodes.get(id)!)
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        });
        if (byName !== 0) {
          return byName;
        }
        return left.manifestPath.localeCompare(right.manifestPath, undefined, {
          sensitivity: "base",
        });
      });

    return {
      inputKind: graph.inputKind,
      root,
      projects,
    };
  }
}
