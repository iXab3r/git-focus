using System.Text;
using CliWrap;
using CliWrap.Buffered;

namespace GitFocus.Git;

internal sealed class GitCommandRunner
{
    public async Task<string> RunAsync(
        string repositoryRoot,
        IEnumerable<string> arguments,
        CancellationToken cancellationToken)
    {
        var result = await Cli.Wrap("git")
            .WithArguments(["-C", repositoryRoot, .. arguments])
            .WithValidation(CommandResultValidation.None)
            .ExecuteBufferedAsync(Encoding.UTF8, cancellationToken)
            .ConfigureAwait(false);

        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"git {string.Join(' ', arguments)} failed in `{repositoryRoot}`:{Environment.NewLine}" +
                result.StandardError.Trim());
        }

        return result.StandardOutput;
    }

    public async Task<(int ExitCode, string StandardOutput)> TryRunAsync(
        string repositoryRoot,
        IEnumerable<string> arguments,
        CancellationToken cancellationToken)
    {
        var result = await Cli.Wrap("git")
            .WithArguments(["-C", repositoryRoot, .. arguments])
            .WithValidation(CommandResultValidation.None)
            .ExecuteBufferedAsync(Encoding.UTF8, cancellationToken)
            .ConfigureAwait(false);
        return (result.ExitCode, result.StandardOutput);
    }
}
