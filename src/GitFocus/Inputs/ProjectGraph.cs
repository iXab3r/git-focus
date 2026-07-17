namespace GitFocus.Core;

public enum ProjectDependencyKind
{
    Runtime,
    Build,
    Development,
}

public sealed record ProjectDependency(string TargetId, ProjectDependencyKind Kind);

public sealed record ProjectNode(
    string Id,
    string Name,
    string ManifestPath,
    IReadOnlyList<string> SourceDirectories,
    IReadOnlyList<ProjectDependency> Dependencies);

public sealed record ProjectGraph(
    ProjectInputKind InputKind,
    string RootId,
    IReadOnlyDictionary<string, ProjectNode> Nodes);

public sealed record FocusSelection(
    ProjectInputKind InputKind,
    ProjectNode Root,
    IReadOnlyList<ProjectNode> Projects)
{
    public IReadOnlyList<string> SourceDirectories => Projects
        .SelectMany(project => project.SourceDirectories)
        .Select(Path.GetFullPath)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Order(StringComparer.OrdinalIgnoreCase)
        .ToArray();
}
