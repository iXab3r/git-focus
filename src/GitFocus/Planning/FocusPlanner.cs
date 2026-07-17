namespace GitFocus.Core;

public sealed class FocusPlanner(ProjectInputResolverRegistry registry)
{
    public async Task<FocusSelection> PlanAsync(
        FocusRequest request,
        CancellationToken cancellationToken = default)
    {
        var resolver = registry.Resolve(request);
        var graph = await resolver.ResolveAsync(request, cancellationToken).ConfigureAwait(false);
        if (!graph.Nodes.TryGetValue(graph.RootId, out var root))
        {
            throw new InvalidOperationException($"Input resolver `{resolver.Kind}` returned an unknown root node.");
        }

        var selected = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Queue<string>();
        pending.Enqueue(graph.RootId);

        while (pending.TryDequeue(out var nodeId))
        {
            if (!selected.Add(nodeId))
            {
                continue;
            }

            if (!graph.Nodes.TryGetValue(nodeId, out var node))
            {
                throw new InvalidOperationException(
                    $"Input resolver `{resolver.Kind}` returned dependency `{nodeId}` without a project node.");
            }

            foreach (var dependency in node.Dependencies)
            {
                if (dependency.Kind == ProjectDependencyKind.Development &&
                    !request.IncludeDevelopmentDependencies)
                {
                    continue;
                }

                pending.Enqueue(dependency.TargetId);
            }
        }

        var projects = selected
            .Select(id => graph.Nodes[id])
            .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(project => project.ManifestPath, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new FocusSelection(graph.InputKind, root, projects);
    }
}
