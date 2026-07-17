using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CliWrap;
using CliWrap.Buffered;
using GitFocus.Core;

namespace GitFocus.Inputs.Cargo;

public sealed class CargoProjectInputResolver : IProjectInputResolver
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public ProjectInputKind Kind => ProjectInputKind.Cargo;

    public bool CanResolve(FocusRequest request) =>
        string.Equals(Path.GetFileName(request.FullInputPath), "Cargo.toml", StringComparison.OrdinalIgnoreCase);

    public async Task<ProjectGraph> ResolveAsync(
        FocusRequest request,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(request.FullInputPath))
        {
            throw new FileNotFoundException("Cargo manifest does not exist.", request.FullInputPath);
        }

        var workingDirectory = Path.GetDirectoryName(request.FullInputPath)
            ?? throw new InvalidOperationException("Cargo manifest has no parent directory.");
        var arguments = new List<string>
        {
            "metadata",
            "--format-version",
            "1",
            "--all-features",
            "--manifest-path",
            request.FullInputPath,
        };

        var lockFile = FindNearestFile(workingDirectory, "Cargo.lock");
        if (lockFile is not null)
        {
            arguments.Add("--locked");
        }

        var result = await Cli.Wrap("cargo")
            .WithArguments(arguments)
            .WithWorkingDirectory(workingDirectory)
            .WithValidation(CommandResultValidation.None)
            .ExecuteBufferedAsync(Encoding.UTF8, cancellationToken)
            .ConfigureAwait(false);

        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"cargo metadata failed for `{request.FullInputPath}`:{Environment.NewLine}{result.StandardError.Trim()}");
        }

        var metadata = JsonSerializer.Deserialize<CargoMetadata>(result.StandardOutput, JsonOptions)
            ?? throw new InvalidOperationException("cargo metadata returned an empty document.");
        if (metadata.Resolve is null)
        {
            throw new InvalidOperationException("cargo metadata did not return a resolved dependency graph.");
        }

        var localPackages = metadata.Packages
            .Where(package => package.Source is null)
            .ToDictionary(package => package.Id, StringComparer.Ordinal);
        var rootPackage = FindRootPackage(request.FullInputPath, localPackages.Values);
        var sourceDirectories = localPackages.Values.ToDictionary(
            package => package.Id,
            package => CreateSourceDirectories(package.ManifestPath),
            StringComparer.Ordinal);

        var requestedDirectory = Path.GetDirectoryName(request.FullInputPath)!;
        sourceDirectories[rootPackage.Id].Add(requestedDirectory);
        sourceDirectories[rootPackage.Id].Add(ResolveDirectoryLink(requestedDirectory));

        AddDeclaredPathAliases(localPackages, sourceDirectories);

        var resolvedNodes = metadata.Resolve.Nodes.ToDictionary(node => node.Id, StringComparer.Ordinal);
        var nodes = new Dictionary<string, ProjectNode>(StringComparer.Ordinal);
        foreach (var package in localPackages.Values)
        {
            resolvedNodes.TryGetValue(package.Id, out var resolvedNode);
            var dependencies = resolvedNode?.Dependencies
                .Where(dependency => localPackages.ContainsKey(dependency.PackageId))
                .SelectMany(dependency => ToDependencies(dependency))
                .Distinct()
                .ToArray()
                ?? [];

            nodes.Add(
                package.Id,
                new ProjectNode(
                    package.Id,
                    package.Name,
                    Path.GetFullPath(package.ManifestPath),
                    sourceDirectories[package.Id].Order(StringComparer.OrdinalIgnoreCase).ToArray(),
                    dependencies));
        }

        return new ProjectGraph(Kind, rootPackage.Id, nodes);
    }

    private static HashSet<string> CreateSourceDirectories(string manifestPath)
    {
        var manifestDirectory = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            manifestDirectory,
            ResolveDirectoryLink(manifestDirectory),
        };
    }

    private static CargoPackage FindRootPackage(string manifestPath, IEnumerable<CargoPackage> packages)
    {
        var requestedDirectory = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        var requestedCanonicalDirectory = ResolveDirectoryLink(requestedDirectory);
        return packages.SingleOrDefault(package =>
            PathsEqual(package.ManifestPath, manifestPath) ||
            PathsEqual(
                ResolveDirectoryLink(Path.GetDirectoryName(package.ManifestPath)!),
                requestedCanonicalDirectory))
            ?? throw new InvalidOperationException(
                $"cargo metadata did not include the requested manifest `{manifestPath}` as a local package.");
    }

    private static void AddDeclaredPathAliases(
        IReadOnlyDictionary<string, CargoPackage> localPackages,
        IReadOnlyDictionary<string, HashSet<string>> sourceDirectories)
    {
        foreach (var package in localPackages.Values)
        {
            foreach (var dependency in package.Dependencies.Where(dependency => dependency.Path is not null))
            {
                var candidates = localPackages.Values
                    .Where(candidate => string.Equals(candidate.Name, dependency.Name, StringComparison.Ordinal) ||
                                        PathsEqual(
                                            Path.GetDirectoryName(candidate.ManifestPath)!,
                                            ResolveDirectoryLink(dependency.Path!)))
                    .ToArray();
                if (candidates.Length == 1)
                {
                    sourceDirectories[candidates[0].Id].Add(Path.GetFullPath(dependency.Path!));
                }
            }
        }
    }

    private static IEnumerable<ProjectDependency> ToDependencies(CargoResolvedDependency dependency)
    {
        if (dependency.Kinds.Count == 0)
        {
            yield return new ProjectDependency(dependency.PackageId, ProjectDependencyKind.Runtime);
            yield break;
        }

        foreach (var kind in dependency.Kinds.Select(kind => kind.Kind).Distinct(StringComparer.Ordinal))
        {
            yield return new ProjectDependency(
                dependency.PackageId,
                kind switch
                {
                    "dev" => ProjectDependencyKind.Development,
                    "build" => ProjectDependencyKind.Build,
                    _ => ProjectDependencyKind.Runtime,
                });
        }
    }

    private static string? FindNearestFile(string startDirectory, string fileName)
    {
        for (var directory = new DirectoryInfo(startDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, fileName);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static string ResolveDirectoryLink(string path)
    {
        var directory = new DirectoryInfo(Path.GetFullPath(path));
        return directory.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? directory.FullName;
    }

    private static bool PathsEqual(string left, string right) =>
        string.Equals(
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private sealed record CargoMetadata(
        [property: JsonPropertyName("packages")] IReadOnlyList<CargoPackage> Packages,
        [property: JsonPropertyName("resolve")] CargoResolve? Resolve);

    private sealed record CargoPackage(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("source")] string? Source,
        [property: JsonPropertyName("manifest_path")] string ManifestPath,
        [property: JsonPropertyName("dependencies")] IReadOnlyList<CargoPackageDependency> Dependencies);

    private sealed record CargoPackageDependency(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("path")] string? Path);

    private sealed record CargoResolve(
        [property: JsonPropertyName("nodes")] IReadOnlyList<CargoResolveNode> Nodes);

    private sealed record CargoResolveNode(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("deps")] IReadOnlyList<CargoResolvedDependency> Dependencies);

    private sealed record CargoResolvedDependency(
        [property: JsonPropertyName("pkg")] string PackageId,
        [property: JsonPropertyName("dep_kinds")] IReadOnlyList<CargoDependencyKind> Kinds);

    private sealed record CargoDependencyKind(
        [property: JsonPropertyName("kind")] string? Kind);
}
