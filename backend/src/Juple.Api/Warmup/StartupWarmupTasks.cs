using System.Diagnostics;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.Warmup;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.Api.Warmup;

/// <summary>
/// The first signed-in request used to wait 0.7-2.0 s for the identity provider's OpenID configuration and signing keys. Fetches them
/// now, through the very configuration manager the JWT bearer handler validates with (the one it caches and refreshes itself) - so the
/// first real request finds them loaded. NO token is created, parsed or validated, no person is authenticated, no request goes through
/// the authentication pipeline: it only asks the metadata source the handler already has.
/// </summary>
public sealed class AuthMetadataWarmupTask(ILogger<AuthMetadataWarmupTask> logger) : IStartupWarmupTask
{
    public string Name => "AuthMetadata";

    public int Order => 10;

    public WarmupCriticality Criticality => WarmupCriticality.Critical;

    public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        // The registered default scheme - never a hard-coded name.
        var scheme = await services.GetRequiredService<IAuthenticationSchemeProvider>().GetDefaultAuthenticateSchemeAsync();
        var jwt = scheme is null ? null : services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(scheme.Name);
        if (jwt?.ConfigurationManager is not { } configurationManager)
        {
            logger.LogInformation("StartupWarmup Step=AuthMetadata Detail=NoConfigurationManager");
            return;
        }

        var configuration = await configurationManager.GetConfigurationAsync(cancellationToken);
        logger.LogInformation("StartupWarmup Step=AuthMetadata Detail=Loaded SigningKeys={SigningKeys}", configuration.SigningKeys.Count);
    }
}

/// <summary>
/// Builds the EF model and the context's runtime services before the first request needs them (public API only: <c>DbContext.Model</c>
/// and its entity types). The model is built once per process and cached.
/// </summary>
public sealed class EfModelWarmupTask(ILogger<EfModelWarmupTask> logger) : IStartupWarmupTask
{
    public string Name => "EfModel";

    public int Order => 20;

    public WarmupCriticality Criticality => WarmupCriticality.Critical;

    public Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var dbContext = services.GetRequiredService<JupleDbContext>();
        var entityTypes = dbContext.Model.GetEntityTypes().Count();
        logger.LogInformation("StartupWarmup Step=EfModel Detail=Built EntityTypes={EntityTypes}", entityTypes);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Fills the SQL connection pool: <see cref="StartupWarmupOptions.ConnectionPoolSize"/> connections opened at the same moment (see
/// <see cref="SqlConnectionPoolWarmer"/>). It is also the database reachability check - critical, because an unreachable database means
/// nothing else would work either.
/// </summary>
public sealed class ConnectionPoolWarmupTask(IOptions<StartupWarmupOptions> options, ILogger<ConnectionPoolWarmupTask> logger) : IStartupWarmupTask
{
    public string Name => "ConnectionPool";

    public int Order => 30;

    public WarmupCriticality Criticality => WarmupCriticality.Critical;

    public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var opened = await SqlConnectionPoolWarmer.WarmAsync(
            services.GetRequiredService<JupleDbContext>(), options.Value.ConnectionPoolSize, cancellationToken);
        logger.LogInformation("StartupWarmup Step=ConnectionPool Count={Count}", opened);
    }
}

/// <summary>
/// Translates the hot query shapes (<see cref="IQueryWarmupSource"/>) so their code paths are compiled before a person needs them -
/// translation only: no command runs, no connection is used, no person's data is read (see <see cref="QueryTranslationSink"/>). Best
/// effort: one shape failing is a warning and the others continue.
/// </summary>
public sealed class QueryCompilationWarmupTask(ILogger<QueryCompilationWarmupTask> logger) : IStartupWarmupTask
{
    public string Name => "QueryCompilation";

    public int Order => 40;

    public WarmupCriticality Criticality => WarmupCriticality.BestEffort;

    public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var failed = 0;
        foreach (var query in services.GetRequiredService<IQueryWarmupSource>().Queries())
        {
            var step = Stopwatch.StartNew();
            try
            {
                var sink = new QueryTranslationSink();
                await query.Translate(sink, cancellationToken);
                logger.LogInformation(
                    "StartupWarmup Step=QueryCompilation Query={Query} Statements={Statements} ElapsedMs={ElapsedMs}",
                    query.Name, sink.Captured, (int)step.ElapsedMilliseconds);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                failed++;
                logger.LogWarning(
                    "StartupWarmup Step=QueryCompilation Query={Query} Result=Failed ElapsedMs={ElapsedMs} Error={ErrorType}",
                    query.Name, (int)step.ElapsedMilliseconds, exception.GetType().Name);
            }
        }

        if (failed > 0)
        {
            throw new InvalidOperationException($"{failed} query shape(s) could not be translated.");
        }
    }
}
