using GitFocus.Core;

namespace GitFocus.Git;

public sealed record RepositorySparsePlan(
    string RepositoryRoot,
    bool IncludeWholeRepository,
    IReadOnlyList<string> IncludedPaths);

public sealed record GitSparsePlan(
    string PrimaryRepositoryRoot,
    string InputPath,
    ProjectInputKind InputKind,
    ProjectNode RootProject,
    IReadOnlyList<ProjectNode> Projects,
    IReadOnlyList<RepositorySparsePlan> Repositories);

public sealed record GitFocusStatus(
    bool IsFocused,
    string PrimaryRepositoryRoot,
    string? InputPath,
    string? InputKind,
    IReadOnlyList<RepositorySparsePlan> Repositories);
