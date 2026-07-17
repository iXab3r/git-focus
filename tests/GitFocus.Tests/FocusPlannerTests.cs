using GitFocus.Core;

namespace GitFocus.Tests;

public sealed class FocusPlannerTests
{
    [Fact]
    public async Task RegistryAndPlannerKeepInputTypesReplaceableAndFilterDevelopmentEdges()
    {
        var cargo = new FakeResolver("cargo", canResolve: true);
        var msbuild = new FakeResolver("msbuild", canResolve: false);
        var registry = new ProjectInputResolverRegistry([cargo, msbuild]);
        var planner = new FocusPlanner(registry);

        var withDevelopment = await planner.PlanAsync(
            new FocusRequest("Cargo.toml", ProjectInputKind.Auto, IncludeDevelopmentDependencies: true));
        var withoutDevelopment = await planner.PlanAsync(
            new FocusRequest("Cargo.toml", ProjectInputKind.Cargo, IncludeDevelopmentDependencies: false));

        Assert.Equal(["app", "dev", "runtime"], withDevelopment.Projects.Select(project => project.Name));
        Assert.Equal(["app", "runtime"], withoutDevelopment.Projects.Select(project => project.Name));
        Assert.Equal(2, cargo.ResolveCount);
        Assert.Equal(0, msbuild.ResolveCount);
    }

    private sealed class FakeResolver(string kind, bool canResolve) : IProjectInputResolver
    {
        public ProjectInputKind Kind { get; } = new(kind);

        public int ResolveCount { get; private set; }

        public bool CanResolve(FocusRequest request) => canResolve;

        public Task<ProjectGraph> ResolveAsync(FocusRequest request, CancellationToken cancellationToken)
        {
            ResolveCount++;
            var root = Path.GetFullPath("Cargo.toml");
            var nodes = new Dictionary<string, ProjectNode>
            {
                ["app"] = new(
                    "app",
                    "app",
                    root,
                    [Path.GetDirectoryName(root)!],
                    [
                        new ProjectDependency("runtime", ProjectDependencyKind.Runtime),
                        new ProjectDependency("dev", ProjectDependencyKind.Development),
                    ]),
                ["runtime"] = new("runtime", "runtime", root, [Path.GetDirectoryName(root)!], []),
                ["dev"] = new("dev", "dev", root, [Path.GetDirectoryName(root)!], []),
            };
            return Task.FromResult(new ProjectGraph(Kind, "app", nodes));
        }
    }
}
