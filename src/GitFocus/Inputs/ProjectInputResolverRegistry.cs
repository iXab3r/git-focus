namespace GitFocus.Core;

public sealed class ProjectInputResolverRegistry
{
    private readonly IReadOnlyList<IProjectInputResolver> resolvers;

    public ProjectInputResolverRegistry(IEnumerable<IProjectInputResolver> resolvers)
    {
        this.resolvers = resolvers.ToArray();
        if (this.resolvers.Count == 0)
        {
            throw new ArgumentException("At least one project input resolver is required.", nameof(resolvers));
        }
    }

    public IProjectInputResolver Resolve(FocusRequest request)
    {
        if (request.InputKind != ProjectInputKind.Auto)
        {
            return resolvers.SingleOrDefault(resolver => resolver.Kind == request.InputKind)
                ?? throw new InvalidOperationException(
                    $"No resolver is registered for input type `{request.InputKind}`. Available types: {AvailableKinds()}.");
        }

        var matches = resolvers.Where(resolver => resolver.CanResolve(request)).ToArray();
        return matches.Length switch
        {
            1 => matches[0],
            0 => throw new InvalidOperationException(
                $"No resolver recognizes `{request.FullInputPath}`. Available types: {AvailableKinds()}."),
            _ => throw new InvalidOperationException(
                $"Multiple resolvers recognize `{request.FullInputPath}`; specify --type explicitly."),
        };
    }

    private string AvailableKinds() => string.Join(", ", resolvers.Select(resolver => resolver.Kind.Value));
}
