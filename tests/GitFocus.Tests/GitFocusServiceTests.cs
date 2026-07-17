using System.Diagnostics;
using GitFocus.Core;
using GitFocus.Git;

namespace GitFocus.Tests;

public sealed class GitFocusServiceTests
{
    [Fact]
    public async Task FocusAndFullRoundTripPreserveIgnoredBuildCache()
    {
        using var temporary = CreateRepository();
        var service = new GitFocusService();
        var selection = CreateSelection(temporary.Path);
        var input = System.IO.Path.Combine(temporary.Path, "src", "App", "Cargo.toml");
        Write(temporary.Path, "local-notes.txt", "untracked\n");

        var plan = await service.PlanAsync(selection, input, temporary.Path, CancellationToken.None);
        await service.ApplyAsync(plan, CancellationToken.None);

        Assert.False(Directory.Exists(System.IO.Path.Combine(temporary.Path, "src", "Other")));
        Assert.True(File.Exists(System.IO.Path.Combine(temporary.Path, "target", "cache.bin")));
        Assert.True(File.Exists(System.IO.Path.Combine(temporary.Path, "local-notes.txt")));
        var focusedStatus = await service.GetStatusAsync(temporary.Path);
        Assert.True(focusedStatus.IsFocused);
        Assert.Equal("cargo", focusedStatus.InputKind);

        await service.RestoreFullAsync(temporary.Path, CancellationToken.None);

        Assert.True(Directory.Exists(System.IO.Path.Combine(temporary.Path, "src", "Other")));
        Assert.True(File.Exists(System.IO.Path.Combine(temporary.Path, "target", "cache.bin")));
        Assert.True(File.Exists(System.IO.Path.Combine(temporary.Path, "local-notes.txt")));
        Assert.False((await service.GetStatusAsync(temporary.Path)).IsFocused);
    }

    [Fact]
    public async Task RefusesToHideDirtyPaths()
    {
        using var temporary = CreateRepository();
        File.AppendAllText(System.IO.Path.Combine(temporary.Path, "src", "Other", "source.txt"), "dirty\n");
        var service = new GitFocusService();
        var input = System.IO.Path.Combine(temporary.Path, "src", "App", "Cargo.toml");
        var plan = await service.PlanAsync(
            CreateSelection(temporary.Path),
            input,
            temporary.Path,
            CancellationToken.None);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.ApplyAsync(plan, CancellationToken.None));

        Assert.Contains("src/Other/source.txt", exception.Message, StringComparison.Ordinal);
        Assert.True(Directory.Exists(System.IO.Path.Combine(temporary.Path, "src", "Other")));
    }

    [Fact]
    public async Task PlanUsesExplicitOuterRepositoryAndIncludesNestedRepositoryChain()
    {
        using var temporary = CreateRepository();
        var nestedRoot = System.IO.Path.Combine(temporary.Path, "modules", "Nested");
        Write(nestedRoot, "src/App/Cargo.toml", "[package]\nname='nested-app'\nversion='0.1.0'\n");
        Write(nestedRoot, "src/App/source.txt", "nested\n");
        RunGit(nestedRoot, "init");
        var service = new GitFocusService();
        var input = System.IO.Path.Combine(nestedRoot, "src", "App", "Cargo.toml");
        var app = new ProjectNode(
            "nested-app",
            "nested-app",
            input,
            [System.IO.Path.GetDirectoryName(input)!],
            []);

        var plan = await service.PlanAsync(
            new FocusSelection(ProjectInputKind.Cargo, app, [app]),
            input,
            temporary.Path,
            CancellationToken.None);

        Assert.Equal(temporary.Path, plan.PrimaryRepositoryRoot);
        Assert.Equal(2, plan.Repositories.Count);
        Assert.Equal("modules/Nested", Assert.Single(plan.Repositories[0].IncludedPaths));
        Assert.Equal("src/App", Assert.Single(plan.Repositories[1].IncludedPaths));
    }

    private static TemporaryDirectory CreateRepository()
    {
        var temporary = new TemporaryDirectory();
        Write(temporary.Path, ".gitignore", "target/\n");
        Write(temporary.Path, "src/App/Cargo.toml", "[package]\nname='app'\nversion='0.1.0'\n");
        Write(temporary.Path, "src/App/source.txt", "app\n");
        Write(temporary.Path, "src/Lib/Cargo.toml", "[package]\nname='lib'\nversion='0.1.0'\n");
        Write(temporary.Path, "src/Lib/source.txt", "lib\n");
        Write(temporary.Path, "src/Other/source.txt", "other\n");
        Write(temporary.Path, "target/cache.bin", "cache\n");
        RunGit(temporary.Path, "init");
        RunGit(temporary.Path, "config", "user.name", "Git Focus Tests");
        RunGit(temporary.Path, "config", "user.email", "git-focus@example.invalid");
        RunGit(temporary.Path, "add", ".");
        RunGit(temporary.Path, "commit", "-m", "fixture");
        return temporary;
    }

    private static FocusSelection CreateSelection(string root)
    {
        var appManifest = System.IO.Path.Combine(root, "src", "App", "Cargo.toml");
        var libManifest = System.IO.Path.Combine(root, "src", "Lib", "Cargo.toml");
        var app = new ProjectNode(
            "app",
            "app",
            appManifest,
            [System.IO.Path.GetDirectoryName(appManifest)!],
            [new ProjectDependency("lib", ProjectDependencyKind.Runtime)]);
        var library = new ProjectNode(
            "lib",
            "lib",
            libManifest,
            [System.IO.Path.GetDirectoryName(libManifest)!],
            []);
        return new FocusSelection(ProjectInputKind.Cargo, app, [app, library]);
    }

    private static void RunGit(string workingDirectory, params string[] arguments)
    {
        var start = new ProcessStartInfo("git")
        {
            WorkingDirectory = workingDirectory,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Failed to start git.");
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(process.StandardError.ReadToEnd());
        }
    }

    private static void Write(string root, string relativePath, string contents)
    {
        var path = System.IO.Path.Combine(root, relativePath);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
    }
}
