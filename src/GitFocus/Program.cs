using System.CommandLine;
using GitFocus.Core;
using GitFocus.Git;
using GitFocus.Inputs.Cargo;

var inputArgument = new Argument<string?>("input")
{
    Arity = ArgumentArity.ZeroOrOne,
    Description = "Project input to focus, such as path/to/Cargo.toml.",
};
var typeOption = new Option<string>("--type")
{
    Description = "Input adapter type. Defaults to auto detection.",
    DefaultValueFactory = _ => "auto",
};
var withoutDevOption = new Option<bool>("--without-dev")
{
    Description = "Exclude development-only local dependencies.",
};
var focusRepositoryOption = new Option<string>("--repo")
{
    Description = "Primary repository boundary. Defaults to the repository containing the current directory.",
    DefaultValueFactory = _ => Environment.CurrentDirectory,
};

var root = new RootCommand("Focus a Git monorepo to one project and its local dependency closure.")
{
    inputArgument,
    typeOption,
    withoutDevOption,
    focusRepositoryOption,
};
root.SetAction(async (parseResult, cancellationToken) =>
{
    var input = parseResult.GetValue(inputArgument);
    if (string.IsNullOrWhiteSpace(input))
    {
        Console.Error.WriteLine("An input project is required. Use `git-focus --help` for usage.");
        return 2;
    }

    return await ExecuteAsync(async services =>
    {
        var request = CreateRequest(parseResult, input, typeOption, withoutDevOption);
        var selection = await services.Planner.PlanAsync(request, cancellationToken).ConfigureAwait(false);
        var repository = parseResult.GetRequiredValue(focusRepositoryOption);
        var plan = await services.Git.PlanAsync(selection, request.FullInputPath, repository, cancellationToken)
            .ConfigureAwait(false);
        PrintPlan(plan);
        await services.Git.ApplyAsync(plan, cancellationToken).ConfigureAwait(false);
        Console.WriteLine("Focused successfully. Run `git-focus full` before selecting another input.");
    }).ConfigureAwait(false);
});

var planInputArgument = new Argument<string>("input")
{
    Description = "Project input to analyze, such as path/to/Cargo.toml.",
};
var planTypeOption = new Option<string>("--type")
{
    Description = "Input adapter type. Defaults to auto detection.",
    DefaultValueFactory = _ => "auto",
};
var planWithoutDevOption = new Option<bool>("--without-dev")
{
    Description = "Exclude development-only local dependencies.",
};
var planRepositoryOption = new Option<string>("--repo")
{
    Description = "Primary repository boundary. Defaults to the repository containing the current directory.",
    DefaultValueFactory = _ => Environment.CurrentDirectory,
};
var planCommand = new Command("plan", "Print the dependency and repository focus plan without changing files.")
{
    planInputArgument,
    planTypeOption,
    planWithoutDevOption,
    planRepositoryOption,
};
planCommand.SetAction(async (parseResult, cancellationToken) => await ExecuteAsync(async services =>
{
    var input = parseResult.GetRequiredValue(planInputArgument);
    var request = CreateRequest(parseResult, input, planTypeOption, planWithoutDevOption);
    var selection = await services.Planner.PlanAsync(request, cancellationToken).ConfigureAwait(false);
    var repository = parseResult.GetRequiredValue(planRepositoryOption);
    var plan = await services.Git.PlanAsync(selection, request.FullInputPath, repository, cancellationToken)
        .ConfigureAwait(false);
    PrintPlan(plan);
}).ConfigureAwait(false));
root.Subcommands.Add(planCommand);

var repositoryOption = new Option<string>("--repo")
{
    Description = "Repository path. Defaults to the current directory.",
    DefaultValueFactory = _ => Environment.CurrentDirectory,
};
var fullCommand = new Command("full", "Restore full source visibility for the last focused repository.")
{
    repositoryOption,
};
fullCommand.SetAction(async (parseResult, cancellationToken) => await ExecuteAsync(async services =>
{
    var repository = parseResult.GetRequiredValue(repositoryOption);
    await services.Git.RestoreFullAsync(repository, cancellationToken).ConfigureAwait(false);
    Console.WriteLine("Full source visibility restored. Build caches and ignored files were not cleaned.");
}).ConfigureAwait(false));
root.Subcommands.Add(fullCommand);

var statusRepositoryOption = new Option<string>("--repo")
{
    Description = "Repository path. Defaults to the current directory.",
    DefaultValueFactory = _ => Environment.CurrentDirectory,
};
var statusCommand = new Command("status", "Show the active git-focus state.")
{
    statusRepositoryOption,
};
statusCommand.SetAction(async (parseResult, cancellationToken) => await ExecuteAsync(async services =>
{
    var repository = parseResult.GetRequiredValue(statusRepositoryOption);
    var status = await services.Git.GetStatusAsync(repository, cancellationToken).ConfigureAwait(false);
    Console.WriteLine(status.IsFocused ? "Mode: focused" : "Mode: full");
    Console.WriteLine($"Repository: {status.PrimaryRepositoryRoot}");
    if (status.IsFocused)
    {
        Console.WriteLine($"Input: {status.InputPath}");
        Console.WriteLine($"Input type: {status.InputKind}");
        foreach (var item in status.Repositories)
        {
            Console.WriteLine($"  {item.RepositoryRoot}");
            foreach (var path in item.IncludedPaths)
            {
                Console.WriteLine($"    {path}");
            }
        }
    }
}).ConfigureAwait(false));
root.Subcommands.Add(statusCommand);

return await root.Parse(args).InvokeAsync().ConfigureAwait(false);

static FocusRequest CreateRequest(
    ParseResult parseResult,
    string input,
    Option<string> typeOption,
    Option<bool> withoutDevOption) =>
    new(
        input,
        ProjectInputKind.Parse(parseResult.GetValue(typeOption)),
        IncludeDevelopmentDependencies: !parseResult.GetValue(withoutDevOption));

static async Task<int> ExecuteAsync(Func<Services, Task> operation)
{
    try
    {
        await operation(Services.Create()).ConfigureAwait(false);
        return 0;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("Operation cancelled.");
        return 130;
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine(exception.Message);
        return 1;
    }
}

static void PrintPlan(GitSparsePlan plan)
{
    Console.WriteLine($"Input type: {plan.InputKind}");
    Console.WriteLine($"Root project: {plan.RootProject.Name}");
    Console.WriteLine($"Projects ({plan.Projects.Count}):");
    foreach (var project in plan.Projects)
    {
        Console.WriteLine($"  {project.Name}  {project.ManifestPath}");
    }

    Console.WriteLine($"Repositories ({plan.Repositories.Count}):");
    foreach (var repository in plan.Repositories)
    {
        Console.WriteLine($"  {repository.RepositoryRoot}");
        if (repository.IncludeWholeRepository)
        {
            Console.WriteLine("    <full repository>");
            continue;
        }

        foreach (var path in repository.IncludedPaths)
        {
            Console.WriteLine($"    {path}");
        }
    }
}

internal sealed record Services(FocusPlanner Planner, GitFocusService Git)
{
    public static Services Create()
    {
        IProjectInputResolver[] resolvers = [new CargoProjectInputResolver()];
        return new Services(
            new FocusPlanner(new ProjectInputResolverRegistry(resolvers)),
            new GitFocusService());
    }
}
