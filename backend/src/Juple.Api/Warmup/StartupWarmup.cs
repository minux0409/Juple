using System.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace Juple.Api.Warmup;

/// <summary>
/// Bound from the "StartupWarmup" configuration section. OFF by default (nothing changes unless a deployment turns it on; Dev does).
/// See <see cref="StartupWarmupRunner"/>.
/// </summary>
public sealed class StartupWarmupOptions
{
    public const string SectionName = "StartupWarmup";

    public bool Enabled { get; set; }

    /// <summary>How many SQL connections are opened AT ONCE to fill the pool (0 = none; capped at 16). Dev's first wave has about four parallel requests.</summary>
    public int ConnectionPoolSize { get; set; } = 4;

    /// <summary>
    /// The whole warm-up budget. When it runs out the instance becomes ready anyway (degraded, logged as an error): readiness is never
    /// held back forever by a dependency that is slow or down - the lazy behaviour it had before is still there.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 45;

    /// <summary>Extra attempts for a critical step that failed (transient dependency errors).</summary>
    public int CriticalRetries { get; set; } = 2;

    public int RetryDelayMilliseconds { get; set; } = 500;
}

/// <summary>What a failed step means: a critical one delays readiness (retried, until the budget); a best-effort one is only logged.</summary>
public enum WarmupCriticality
{
    Critical,
    BestEffort,
}

/// <summary>
/// One start-up warm-up step. Add or remove steps by registering / unregistering an implementation - the runner knows none of them.
/// Steps run one after another in <see cref="Order"/> (later ones may rely on earlier ones: the pool and the EF model before the queries).
/// </summary>
public interface IStartupWarmupTask
{
    string Name { get; }

    int Order { get; }

    WarmupCriticality Criticality { get; }

    /// <summary>Resolve what is needed from <paramref name="services"/> (a scope owned by the runner for this one step).</summary>
    Task RunAsync(IServiceProvider services, CancellationToken cancellationToken);
}

public enum StartupWarmupPhase
{
    NotStarted,
    Running,
    Ready,
    /// <summary>Ready, but at least one critical step did not succeed within the budget.</summary>
    ReadyDegraded,
}

/// <summary>The instance's warm-up state, read by the readiness endpoint. Thread-safe; one per process.</summary>
public sealed class StartupWarmupState
{
    private int _phase;
    private int _begun;

    public StartupWarmupPhase Phase => (StartupWarmupPhase)Volatile.Read(ref _phase);

    public bool IsReady => Phase is StartupWarmupPhase.Ready or StartupWarmupPhase.ReadyDegraded;

    public IReadOnlyList<string> FailedSteps { get; private set; } = [];

    /// <summary>True for exactly one caller: the warm-up runs once per process, however many times it is asked to.</summary>
    public bool TryBegin() => Interlocked.Exchange(ref _begun, 1) == 0;

    public void MarkRunning() => Volatile.Write(ref _phase, (int)StartupWarmupPhase.Running);

    public void MarkReady(IReadOnlyList<string> failedCriticalSteps)
    {
        FailedSteps = failedCriticalSteps;
        Volatile.Write(ref _phase, (int)(failedCriticalSteps.Count == 0 ? StartupWarmupPhase.Ready : StartupWarmupPhase.ReadyDegraded));
    }
}

/// <summary>Healthy once the warm-up finished (<c>/health/ready</c>). Says nothing but the phase - never a dependency, host or detail.</summary>
public sealed class StartupWarmupReadinessCheck(StartupWarmupState state) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
        Task.FromResult(state.IsReady ? HealthCheckResult.Healthy("ready") : HealthCheckResult.Unhealthy("warming up"));
}

/// <summary>
/// Runs the registered warm-up steps once, in order, then flips the state to ready.
///
/// Failure policy (nothing is silent, nothing blocks forever):
///  - A CRITICAL step (authentication metadata, the EF model, the database connection) is retried a couple of times; if it still fails the
///    instance continues, finishes the remaining steps, and becomes ready DEGRADED when the budget ends or the steps are done - with
///    an error log naming the failed steps. The old lazy behaviour (first use pays) simply remains for what could not be warmed.
///  - A BEST-EFFORT step (query translation) is tried once; a failure is a warning.
///  - The whole budget (<see cref="StartupWarmupOptions.TimeoutSeconds"/>) is enforced: when it is over, remaining steps are skipped
///    and the instance becomes ready. Cancellation (shutdown) stops everything without marking ready.
///  - Logs carry step names, durations and the exception TYPE only - no message (it could name a host), no SQL, no id.
/// Disabled: ready at once, nothing runs.
/// </summary>
public sealed class StartupWarmupRunner(
    IEnumerable<IStartupWarmupTask> tasks,
    IServiceScopeFactory scopeFactory,
    IOptions<StartupWarmupOptions> options,
    StartupWarmupState state,
    ILogger<StartupWarmupRunner> logger)
{
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            state.MarkReady([]);
            logger.LogInformation("StartupWarmup Status=Disabled");
            return;
        }

        if (!state.TryBegin())
        {
            return;
        }

        state.MarkRunning();
        var total = Stopwatch.StartNew();
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, settings.TimeoutSeconds)));
        var failedCritical = new List<string>();
        var timedOut = false;

        foreach (var task in tasks.OrderBy(task => task.Order))
        {
            if (budget.IsCancellationRequested)
            {
                break;
            }

            try
            {
                if (!await RunStepAsync(task, settings, budget.Token) && task.Criticality == WarmupCriticality.Critical)
                {
                    failedCritical.Add(task.Name);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                logger.LogInformation("StartupWarmup Status=Cancelled ElapsedMs={ElapsedMs}", (int)total.ElapsedMilliseconds);
                return;
            }
            catch (OperationCanceledException)
            {
                // The budget ran out inside this step.
                timedOut = true;
                logger.LogWarning("StartupWarmup Step={Step} Result=TimedOut", task.Name);
                if (task.Criticality == WarmupCriticality.Critical)
                {
                    failedCritical.Add(task.Name);
                }
            }
        }

        timedOut |= budget.IsCancellationRequested && !cancellationToken.IsCancellationRequested;
        state.MarkReady(failedCritical);
        if (failedCritical.Count == 0)
        {
            logger.LogInformation(
                "StartupWarmupCompleted Status=Ready ElapsedMs={ElapsedMs} TimedOut={TimedOut}", (int)total.ElapsedMilliseconds, timedOut);
        }
        else
        {
            logger.LogError(
                "StartupWarmupCompleted Status=ReadyDegraded ElapsedMs={ElapsedMs} TimedOut={TimedOut} FailedSteps={FailedSteps}",
                (int)total.ElapsedMilliseconds, timedOut, string.Join(',', failedCritical));
        }
    }

    /// <summary>One step with its retries. True: it succeeded. False: it failed for good (already logged).</summary>
    private async Task<bool> RunStepAsync(IStartupWarmupTask task, StartupWarmupOptions settings, CancellationToken cancellationToken)
    {
        var attempts = task.Criticality == WarmupCriticality.Critical ? 1 + Math.Max(0, settings.CriticalRetries) : 1;
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            var step = Stopwatch.StartNew();
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                await task.RunAsync(scope.ServiceProvider, cancellationToken);
                logger.LogInformation("StartupWarmup Step={Step} Result=Ok Attempt={Attempt} ElapsedMs={ElapsedMs}", task.Name, attempt, (int)step.ElapsedMilliseconds);
                return true;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // The budget (or the shutdown) ended this step - the caller tells the two apart.
                throw;
            }
            catch (Exception exception)
            {
                // Includes a step's own cancellation (an HTTP timeout inside it): that is a failure of the step, not of the budget.
                var last = attempt == attempts;
                logger.Log(
                    last ? (task.Criticality == WarmupCriticality.Critical ? LogLevel.Error : LogLevel.Warning) : LogLevel.Warning,
                    "StartupWarmup Step={Step} Result=Failed Attempt={Attempt} Of={Attempts} ElapsedMs={ElapsedMs} Error={ErrorType}",
                    task.Name, attempt, attempts, (int)step.ElapsedMilliseconds, exception.GetType().Name);
                if (last)
                {
                    return false;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(Math.Max(0, settings.RetryDelayMilliseconds)), cancellationToken);
            }
        }

        return false;
    }
}

/// <summary>Starts the runner right after the host starts; it never delays startup or <c>/health</c> (liveness).</summary>
public sealed class StartupWarmupHostedService(StartupWarmupRunner runner, StartupWarmupState state, ILogger<StartupWarmupHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Hand startup back at once - nothing below may hold up the host or the liveness probe.
        await Task.Yield();
        try
        {
            await runner.RunAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            // The runner handles step failures; this is a bug in the runner itself. Never leave the instance unready for good.
            logger.LogError("StartupWarmup Status=RunnerFailed Error={ErrorType}", exception.GetType().Name);
            state.MarkReady(["runner"]);
        }
    }
}
