import type { FocusRequest, ProjectInputResolver } from "./types.js";

export class ProjectInputResolverRegistry {
  private readonly resolvers: ProjectInputResolver[];

  constructor(resolvers: Iterable<ProjectInputResolver>) {
    this.resolvers = [...resolvers];
    if (this.resolvers.length === 0) {
      throw new Error("At least one project input resolver is required.");
    }
  }

  resolve(request: FocusRequest): ProjectInputResolver {
    if (request.inputKind !== "auto") {
      const match = this.resolvers.find(
        (resolver) => resolver.kind === request.inputKind,
      );
      if (!match) {
        throw new Error(
          `No resolver is registered for input type \`${request.inputKind}\`. Available types: ${this.availableKinds()}.`,
        );
      }
      return match;
    }

    const matches = this.resolvers.filter((resolver) =>
      resolver.canResolve(request),
    );
    if (matches.length === 1) {
      return matches[0]!;
    }
    if (matches.length === 0) {
      throw new Error(
        `No resolver recognizes \`${request.fullInputPath}\`. Available types: ${this.availableKinds()}.`,
      );
    }
    throw new Error(
      `Multiple resolvers recognize \`${request.fullInputPath}\`; specify --type explicitly.`,
    );
  }

  private availableKinds(): string {
    return this.resolvers.map((resolver) => resolver.kind).join(", ");
  }
}
