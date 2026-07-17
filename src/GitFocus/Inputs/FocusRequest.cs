namespace GitFocus.Core;

public sealed record FocusRequest(
    string InputPath,
    ProjectInputKind InputKind,
    bool IncludeDevelopmentDependencies = true)
{
    public string FullInputPath { get; } = Path.GetFullPath(InputPath);
}
