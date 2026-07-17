using GitFocus.Core;
using GitFocus.Inputs.Cargo;

namespace GitFocus.Tests;

public sealed class CargoProjectInputResolverTests
{
    [Fact]
    public async Task ResolvesRuntimeBuildAndDevelopmentPathDependencies()
    {
        using var temporary = new TemporaryDirectory();
        Write(temporary.Path, "Cargo.toml", """
            [workspace]
            resolver = "2"
            members = ["app", "runtime", "build-helper", "dev-helper"]
            """);
        Write(temporary.Path, "app/Cargo.toml", """
            [package]
            name = "app"
            version = "0.1.0"
            edition = "2024"

            [dependencies]
            runtime = { path = "../runtime" }

            [build-dependencies]
            build-helper = { path = "../build-helper" }

            [dev-dependencies]
            dev-helper = { path = "../dev-helper" }
            """);
        Write(temporary.Path, "app/src/lib.rs", "pub fn app() {}\n");
        WritePackage(temporary.Path, "runtime");
        WritePackage(temporary.Path, "build-helper");
        WritePackage(temporary.Path, "dev-helper");

        var resolver = new CargoProjectInputResolver();
        var graph = await resolver.ResolveAsync(
            new FocusRequest(
                System.IO.Path.Combine(temporary.Path, "app", "Cargo.toml"),
                ProjectInputKind.Cargo),
            CancellationToken.None);
        var planner = new FocusPlanner(new ProjectInputResolverRegistry([resolver]));
        var selection = await planner.PlanAsync(
            new FocusRequest(
                System.IO.Path.Combine(temporary.Path, "app", "Cargo.toml"),
                ProjectInputKind.Cargo),
            CancellationToken.None);

        Assert.Equal("app", graph.Nodes[graph.RootId].Name);
        Assert.Equal(
            ["app", "build-helper", "dev-helper", "runtime"],
            selection.Projects.Select(project => project.Name));
    }

    private static void WritePackage(string root, string name)
    {
        Write(root, $"{name}/Cargo.toml", $$"""
            [package]
            name = "{{name}}"
            version = "0.1.0"
            edition = "2024"
            """);
        Write(root, $"{name}/src/lib.rs", "pub fn marker() {}\n");
    }

    private static void Write(string root, string relativePath, string contents)
    {
        var path = System.IO.Path.Combine(root, relativePath);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
    }
}
