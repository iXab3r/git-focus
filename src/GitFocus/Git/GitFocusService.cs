using System.Text.Json;
using GitFocus.Core;

namespace GitFocus.Git;

public sealed class GitFocusService
{
    private static readonly JsonSerializerOptions StateJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly GitCommandRunner git = new();

    public Task<GitSparsePlan> PlanAsync(
        FocusSelection selection,
        string inputPath,
        string repositoryPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var fullInputPath = Path.GetFullPath(inputPath);
        var primaryRoot = FindRepositoryRootLexically(Path.GetFullPath(repositoryPath));
        if (!IsInside(primaryRoot, fullInputPath))
        {
            throw new InvalidOperationException(
                $"Input `{fullInputPath}` is outside the primary repository `{primaryRoot}`.");
        }

        var repositories = new Dictionary<string, MutableRepositoryPlan>(PathComparer);

        foreach (var sourceDirectory in selection.SourceDirectories)
        {
            var fullSourceDirectory = Path.GetFullPath(sourceDirectory);
            if (!IsInside(primaryRoot, fullSourceDirectory))
            {
                throw new InvalidOperationException(
                    $"Local dependency `{fullSourceDirectory}` is outside the primary repository `{primaryRoot}`. " +
                    "Cross-repository focus is not supported yet; use a submodule or place the dependency under the repository root.");
            }

            var owningRoot = FindRepositoryRootLexically(fullSourceDirectory);
            AddPath(repositories, owningRoot, fullSourceDirectory);
            AddNestedRepositoryChain(repositories, primaryRoot, owningRoot);
        }

        var repositoryPlans = repositories.Values
            .OrderBy(plan => PathDepth(plan.RepositoryRoot))
            .Select(plan => plan.ToImmutable())
            .ToArray();
        return Task.FromResult(new GitSparsePlan(
            primaryRoot,
            fullInputPath,
            selection.InputKind,
            selection.Root,
            selection.Projects,
            repositoryPlans));
    }

    public async Task ApplyAsync(
        GitSparsePlan plan,
        bool force,
        CancellationToken cancellationToken = default)
    {
        if (await IsFocusedAsync(plan.PrimaryRepositoryRoot, cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException(
                "This repository is already focused. Run `git-focus full` before selecting another input.");
        }

        if (!force)
        {
            foreach (var repository in plan.Repositories)
            {
                await EnsureCleanWorkingTreeAsync(repository.RepositoryRoot, cancellationToken).ConfigureAwait(false);
            }
        }

        var applied = new List<RepositorySparsePlan>();
        try
        {
            foreach (var repository in plan.Repositories)
            {
                if (repository.IncludeWholeRepository)
                {
                    continue;
                }

                await git.RunAsync(
                    repository.RepositoryRoot,
                    [
                        "sparse-checkout",
                        "set",
                        "--cone",
                        "--sparse-index",
                        "--skip-checks",
                        .. repository.IncludedPaths,
                    ],
                    cancellationToken).ConfigureAwait(false);
                applied.Add(repository);
            }

            await WriteStateAsync(plan, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            foreach (var repository in applied.AsEnumerable().Reverse())
            {
                await git.TryRunAsync(
                    repository.RepositoryRoot,
                    ["sparse-checkout", "disable"],
                    CancellationToken.None).ConfigureAwait(false);
            }

            throw;
        }
    }

    public async Task RestoreFullAsync(
        string repositoryPath,
        CancellationToken cancellationToken = default)
    {
        var primaryRoot = FindRepositoryRootLexically(Path.GetFullPath(repositoryPath));
        var state = await ReadStateAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
        var repositories = state?.Repositories ??
            [new RepositorySparsePlan(primaryRoot, IncludeWholeRepository: false, IncludedPaths: [])];

        foreach (var repository in repositories.OrderByDescending(item => PathDepth(item.RepositoryRoot)))
        {
            var (exitCode, _) = await git.TryRunAsync(
                repository.RepositoryRoot,
                ["config", "--bool", "core.sparseCheckout"],
                cancellationToken).ConfigureAwait(false);
            if (exitCode == 0)
            {
                await git.RunAsync(
                    repository.RepositoryRoot,
                    ["sparse-checkout", "disable"],
                    cancellationToken).ConfigureAwait(false);
            }
        }

        await DeleteStateAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
    }

    public async Task<GitFocusStatus> GetStatusAsync(
        string repositoryPath,
        CancellationToken cancellationToken = default)
    {
        var primaryRoot = FindRepositoryRootLexically(Path.GetFullPath(repositoryPath));
        var state = await ReadStateAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
        return state is null
            ? new GitFocusStatus(false, primaryRoot, null, null, [])
            : new GitFocusStatus(
                true,
                primaryRoot,
                state.InputPath,
                state.InputKind,
                state.Repositories);
    }

    public async Task EnsureCleanAsync(
        string repositoryPath,
        bool force,
        CancellationToken cancellationToken = default)
    {
        if (force)
        {
            return;
        }

        var repositoryRoot = FindRepositoryRootLexically(Path.GetFullPath(repositoryPath));
        await EnsureCleanWorkingTreeAsync(repositoryRoot, cancellationToken).ConfigureAwait(false);
    }

    private async Task EnsureCleanWorkingTreeAsync(
        string repositoryRoot,
        CancellationToken cancellationToken)
    {
        var status = await git.RunAsync(
            repositoryRoot,
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            cancellationToken).ConfigureAwait(false);
        var changes = ParseStatusPaths(status)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (changes.Length > 0)
        {
            throw new InvalidOperationException(
                $"Repository `{repositoryRoot}` contains uncommitted changes. " +
                $"Commit or stash them before focusing, or pass `--force` to override:{Environment.NewLine}" +
                string.Join(Environment.NewLine, changes.Select(path => $"  {path}")));
        }
    }

    private async Task<bool> IsFocusedAsync(string primaryRoot, CancellationToken cancellationToken)
    {
        var state = await ReadStateAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
        if (state is not null)
        {
            return true;
        }

        var (exitCode, output) = await git.TryRunAsync(
            primaryRoot,
            ["config", "--bool", "core.sparseCheckout"],
            cancellationToken).ConfigureAwait(false);
        return exitCode == 0 && string.Equals(output.Trim(), "true", StringComparison.OrdinalIgnoreCase);
    }

    private async Task WriteStateAsync(GitSparsePlan plan, CancellationToken cancellationToken)
    {
        var statePath = await GetStatePathAsync(plan.PrimaryRepositoryRoot, cancellationToken).ConfigureAwait(false);
        Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
        var state = new GitFocusState(
            plan.InputPath,
            plan.InputKind.Value,
            plan.Repositories,
            DateTimeOffset.UtcNow);
        await File.WriteAllTextAsync(
            statePath,
            JsonSerializer.Serialize(state, StateJsonOptions),
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<GitFocusState?> ReadStateAsync(string primaryRoot, CancellationToken cancellationToken)
    {
        var statePath = await GetStatePathAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
        if (!File.Exists(statePath))
        {
            return null;
        }

        await using var stream = File.OpenRead(statePath);
        return await JsonSerializer.DeserializeAsync<GitFocusState>(stream, StateJsonOptions, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task DeleteStateAsync(string primaryRoot, CancellationToken cancellationToken)
    {
        var statePath = await GetStatePathAsync(primaryRoot, cancellationToken).ConfigureAwait(false);
        if (File.Exists(statePath))
        {
            File.Delete(statePath);
        }
    }

    private async Task<string> GetStatePathAsync(string primaryRoot, CancellationToken cancellationToken)
    {
        var path = (await git.RunAsync(
            primaryRoot,
            ["rev-parse", "--git-path", "git-focus/state.json"],
            cancellationToken).ConfigureAwait(false)).Trim();
        return Path.IsPathRooted(path) ? path : Path.GetFullPath(path, primaryRoot);
    }

    private static IEnumerable<string> ParseStatusPaths(string status)
    {
        var position = 0;
        while (position < status.Length)
        {
            if (position + 3 > status.Length)
            {
                yield break;
            }

            var code = status.Substring(position, 2);
            position += 3;
            var path = ReadNullTerminated(status, ref position);
            yield return NormalizeGitPath(path);
            if (code.Contains('R') || code.Contains('C'))
            {
                yield return NormalizeGitPath(ReadNullTerminated(status, ref position));
            }
        }
    }

    private static string ReadNullTerminated(string value, ref int position)
    {
        var end = value.IndexOf('\0', position);
        if (end < 0)
        {
            end = value.Length;
        }

        var result = value[position..end];
        position = Math.Min(end + 1, value.Length);
        return result;
    }

    private static void AddPath(
        IDictionary<string, MutableRepositoryPlan> repositories,
        string repositoryRoot,
        string sourceDirectory)
    {
        if (!repositories.TryGetValue(repositoryRoot, out var plan))
        {
            plan = new MutableRepositoryPlan(repositoryRoot);
            repositories.Add(repositoryRoot, plan);
        }

        var relative = Path.GetRelativePath(repositoryRoot, sourceDirectory);
        if (relative == ".")
        {
            plan.IncludeWholeRepository = true;
            return;
        }

        plan.IncludedPaths.Add(NormalizeGitPath(relative));
    }

    private static void AddNestedRepositoryChain(
        IDictionary<string, MutableRepositoryPlan> repositories,
        string primaryRoot,
        string repositoryRoot)
    {
        var nestedRoot = repositoryRoot;
        while (!PathsEqual(nestedRoot, primaryRoot))
        {
            var parentSearchStart = Directory.GetParent(nestedRoot)?.FullName
                ?? throw new InvalidOperationException($"Repository `{nestedRoot}` has no parent.");
            var parentRoot = FindRepositoryRootLexically(parentSearchStart);
            AddPath(repositories, parentRoot, nestedRoot);
            nestedRoot = parentRoot;
        }
    }

    private static string FindRepositoryRootLexically(string startPath)
    {
        var start = Directory.Exists(startPath) ? startPath : Path.GetDirectoryName(startPath)!;
        for (var directory = new DirectoryInfo(Path.GetFullPath(start));
             directory is not null;
             directory = directory.Parent)
        {
            var marker = Path.Combine(directory.FullName, ".git");
            if (Directory.Exists(marker) || File.Exists(marker))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException($"`{startPath}` is not inside a Git repository.");
    }

    private static bool IsInside(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        return relative == "." ||
               (!relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
                !Path.IsPathRooted(relative));
    }

    private static int PathDepth(string path) =>
        Path.GetFullPath(path).Count(character => character == Path.DirectorySeparatorChar);

    private static bool PathsEqual(string left, string right) =>
        PathComparer.Equals(
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)));

    private static string NormalizeGitPath(string path) => path.Replace('\\', '/').Trim('/');

    private static StringComparer PathComparer =>
        OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private sealed class MutableRepositoryPlan(string repositoryRoot)
    {
        public string RepositoryRoot { get; } = repositoryRoot;

        public bool IncludeWholeRepository { get; set; }

        public HashSet<string> IncludedPaths { get; } = new(StringComparer.Ordinal);

        public RepositorySparsePlan ToImmutable() => new(
            RepositoryRoot,
            IncludeWholeRepository,
            IncludedPaths.Order(StringComparer.Ordinal).ToArray());
    }

    private sealed record GitFocusState(
        string InputPath,
        string InputKind,
        IReadOnlyList<RepositorySparsePlan> Repositories,
        DateTimeOffset CreatedAt);
}
