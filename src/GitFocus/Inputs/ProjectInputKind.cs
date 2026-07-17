namespace GitFocus.Core;

public readonly record struct ProjectInputKind
{
    public static ProjectInputKind Auto { get; } = new("auto");
    public static ProjectInputKind Cargo { get; } = new("cargo");

    public ProjectInputKind(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Input kind cannot be empty.", nameof(value));
        }

        Value = value.Trim().ToLowerInvariant();
    }

    public string Value { get; }

    public override string ToString() => Value;

    public static ProjectInputKind Parse(string? value) =>
        string.IsNullOrWhiteSpace(value) ? Auto : new ProjectInputKind(value);
}
