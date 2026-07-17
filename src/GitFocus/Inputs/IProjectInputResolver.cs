namespace GitFocus.Core;

public interface IProjectInputResolver
{
    ProjectInputKind Kind { get; }

    bool CanResolve(FocusRequest request);

    Task<ProjectGraph> ResolveAsync(FocusRequest request, CancellationToken cancellationToken);
}
