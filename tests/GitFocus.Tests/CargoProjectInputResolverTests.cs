using GitFocus.Core;
using GitFocus.Inputs.Cargo;
using System.Diagnostics;

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

    [Fact]
    public async Task PreservesFlatAliasAndPhysicalSourceDirectories()
    {
        using var temporary = new TemporaryDirectory();
        Write(temporary.Path, "Cargo.toml", """
            [workspace]
            resolver = "2"
            members = ["flat-app"]
            """);
        WritePackage(temporary.Path, "physical-app");
        var physicalDirectory = System.IO.Path.Combine(temporary.Path, "physical-app");
        var aliasDirectory = System.IO.Path.Combine(temporary.Path, "flat-app");
        CreateDirectoryLink(aliasDirectory, physicalDirectory);

        var resolver = new CargoProjectInputResolver();
        var graph = await resolver.ResolveAsync(
            new FocusRequest(
                System.IO.Path.Combine(aliasDirectory, "Cargo.toml"),
                ProjectInputKind.Cargo),
            CancellationToken.None);
        var root = graph.Nodes[graph.RootId];

        Assert.Contains(aliasDirectory, root.SourceDirectories);
        Assert.Contains(physicalDirectory, root.SourceDirectories);
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

    private static void CreateDirectoryLink(string linkPath, string targetPath)
    {
        if (!OperatingSystem.IsWindows())
        {
            Directory.CreateSymbolicLink(linkPath, targetPath);
            return;
        }

        var startInfo = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        startInfo.ArgumentList.Add("/d");
        startInfo.ArgumentList.Add("/c");
        startInfo.ArgumentList.Add("mklink");
        startInfo.ArgumentList.Add("/J");
        startInfo.ArgumentList.Add(linkPath);
        startInfo.ArgumentList.Add(targetPath);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to create test junction.");
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(process.StandardError.ReadToEnd());
        }
    }
}
