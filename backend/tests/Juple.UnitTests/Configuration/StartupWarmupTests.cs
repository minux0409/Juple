using System.Data;
using System.Data.Common;
using Juple.Api.Warmup;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.Diagnostics;
using Juple.Infrastructure.Persistence.Warmup;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Juple.UnitTests.Configuration;

/// <summary>The start-up warm-up: ordering, readiness, failure policy, timeouts, and what each step does - without touching any database or person.</summary>
public sealed class StartupWarmupTests
{
    private sealed record Entry(LogLevel Level, string Message);

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<Entry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Entries)
            {
                Entries.Add(new Entry(logLevel, formatter(state, exception)));
            }
        }
    }

    private sealed class FakeTask(string name, int order, WarmupCriticality criticality, Func<int, CancellationToken, Task>? run = null, List<string>? journal = null) : IStartupWarmupTask
    {
        public int Calls { get; private set; }

        public string Name => name;

        public int Order => order;

        public WarmupCriticality Criticality => criticality;

        public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
        {
            Calls++;
            journal?.Add(name);
            if (run is not null)
            {
                await run(Calls, cancellationToken);
            }
        }
    }

    private static (StartupWarmupRunner Runner, StartupWarmupState State, CapturingLogger<StartupWarmupRunner> Logger) Create(
        IEnumerable<IStartupWarmupTask> tasks, StartupWarmupOptions? options = null)
    {
        var state = new StartupWarmupState();
        var logger = new CapturingLogger<StartupWarmupRunner>();
        var scopes = new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        var settings = options ?? new StartupWarmupOptions { Enabled = true, RetryDelayMilliseconds = 1 };
        return (new StartupWarmupRunner(tasks, scopes, Options.Create(settings), state, logger), state, logger);
    }

    [Fact]
    public async Task Disabled_IsReadyAtOnce_AndRunsNothing()
    {
        var task = new FakeTask("a", 1, WarmupCriticality.Critical);
        var (runner, state, _) = Create([task], new StartupWarmupOptions { Enabled = false });

        await runner.RunAsync(CancellationToken.None);

        Assert.True(state.IsReady);
        Assert.Equal(StartupWarmupPhase.Ready, state.Phase);
        Assert.Equal(0, task.Calls);
    }

    [Fact]
    public async Task Enabled_IsNotReadyUntilEveryStepFinished_ThenReady()
    {
        var gate = new TaskCompletionSource();
        var observed = new List<bool>();
        StartupWarmupState? stateRef = null;
        var blocking = new FakeTask("block", 1, WarmupCriticality.Critical, async (_, ct) =>
        {
            observed.Add(stateRef!.IsReady);
            await gate.Task.WaitAsync(ct);
        });
        var (runner, state, _) = Create([blocking]);
        stateRef = state;
        Assert.False(state.IsReady);

        var running = runner.RunAsync(CancellationToken.None);
        await Task.Delay(30);
        Assert.False(state.IsReady);
        Assert.Equal(StartupWarmupPhase.Running, state.Phase);
        gate.SetResult();
        await running;

        Assert.True(state.IsReady);
        Assert.Equal(StartupWarmupPhase.Ready, state.Phase);
        Assert.Equal([false], observed);
    }

    [Fact]
    public async Task StepsRunInOrder_WhateverTheRegistrationOrder()
    {
        var journal = new List<string>();
        var (runner, _, _) = Create(
        [
            new FakeTask("queries", 40, WarmupCriticality.BestEffort, journal: journal),
            new FakeTask("auth", 10, WarmupCriticality.Critical, journal: journal),
            new FakeTask("pool", 30, WarmupCriticality.Critical, journal: journal),
            new FakeTask("model", 20, WarmupCriticality.Critical, journal: journal),
        ]);

        await runner.RunAsync(CancellationToken.None);

        Assert.Equal(["auth", "model", "pool", "queries"], journal);
    }

    [Fact]
    public async Task ConcurrentRuns_ExecuteTheWarmupOnce()
    {
        var task = new FakeTask("a", 1, WarmupCriticality.Critical, async (_, ct) => await Task.Delay(50, ct));
        var (runner, state, _) = Create([task]);

        await Task.WhenAll(runner.RunAsync(CancellationToken.None), runner.RunAsync(CancellationToken.None), runner.RunAsync(CancellationToken.None));

        Assert.Equal(1, task.Calls);
        Assert.True(state.IsReady);
    }

    [Fact]
    public async Task ACriticalStep_IsRetried_AndASuccessOnRetryIsReady()
    {
        var task = new FakeTask("auth", 1, WarmupCriticality.Critical, (call, _) => call < 3 ? throw new HttpRequestException("secret-host.example") : Task.CompletedTask);
        var (runner, state, logger) = Create([task]);

        await runner.RunAsync(CancellationToken.None);

        Assert.Equal(3, task.Calls);
        Assert.Equal(StartupWarmupPhase.Ready, state.Phase);
        Assert.DoesNotContain(logger.Entries, entry => entry.Message.Contains("secret-host", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ACriticalStepThatKeepsFailing_ContinuesWithTheOthers_AndEndsReadyDegraded_LoudlyButWithoutDetail()
    {
        var after = new FakeTask("pool", 2, WarmupCriticality.Critical);
        var failing = new FakeTask("auth", 1, WarmupCriticality.Critical, (_, _) => throw new InvalidOperationException("server=db.secret.example;password=hunter2"));
        var (runner, state, logger) = Create([failing, after], new StartupWarmupOptions { Enabled = true, CriticalRetries = 1, RetryDelayMilliseconds = 1 });

        await runner.RunAsync(CancellationToken.None);

        Assert.Equal(2, failing.Calls);
        Assert.Equal(1, after.Calls);
        Assert.True(state.IsReady, "never held back forever");
        Assert.Equal(StartupWarmupPhase.ReadyDegraded, state.Phase);
        Assert.Equal(["auth"], state.FailedSteps);
        var summary = Assert.Single(logger.Entries, entry => entry.Message.StartsWith("StartupWarmupCompleted", StringComparison.Ordinal));
        Assert.Equal(LogLevel.Error, summary.Level);
        Assert.Contains("FailedSteps=auth", summary.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(logger.Entries, entry => entry.Message.Contains("hunter2", StringComparison.Ordinal) || entry.Message.Contains("db.secret", StringComparison.Ordinal));
        Assert.Contains(logger.Entries, entry => entry.Message.Contains("Error=InvalidOperationException", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ABestEffortFailure_IsAWarning_NotRetried_AndStillReady()
    {
        var task = new FakeTask("queries", 1, WarmupCriticality.BestEffort, (_, _) => throw new InvalidOperationException("boom"));
        var (runner, state, logger) = Create([task]);

        await runner.RunAsync(CancellationToken.None);

        Assert.Equal(1, task.Calls);
        Assert.Equal(StartupWarmupPhase.Ready, state.Phase);
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Warning && entry.Message.Contains("Step=queries Result=Failed", StringComparison.Ordinal));
    }

    [Fact]
    public async Task WhenTheBudgetRunsOut_RemainingStepsAreSkipped_AndTheInstanceBecomesReadyDegraded()
    {
        var slow = new FakeTask("pool", 1, WarmupCriticality.Critical, async (_, ct) => await Task.Delay(TimeSpan.FromSeconds(30), ct));
        var later = new FakeTask("queries", 2, WarmupCriticality.BestEffort);
        var (runner, state, logger) = Create([slow, later], new StartupWarmupOptions { Enabled = true, TimeoutSeconds = 1, RetryDelayMilliseconds = 1 });

        await runner.RunAsync(CancellationToken.None);

        Assert.Equal(StartupWarmupPhase.ReadyDegraded, state.Phase);
        Assert.Equal(["pool"], state.FailedSteps);
        Assert.Equal(0, later.Calls);
        Assert.Contains(logger.Entries, entry => entry.Message.Contains("TimedOut=True", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Shutdown_StopsTheWarmup_WithoutMarkingReady()
    {
        using var cts = new CancellationTokenSource();
        var step = new FakeTask("pool", 1, WarmupCriticality.Critical, async (_, ct) => await Task.Delay(TimeSpan.FromSeconds(30), ct));
        var (runner, state, _) = Create([step]);

        var running = runner.RunAsync(cts.Token);
        await Task.Delay(30);
        cts.Cancel();
        await running;

        Assert.False(state.IsReady);
    }

    [Fact]
    public async Task TheReadinessCheck_FollowsTheState()
    {
        var state = new StartupWarmupState();
        var check = new StartupWarmupReadinessCheck(state);

        Assert.Equal(HealthStatus.Unhealthy, (await check.CheckHealthAsync(new HealthCheckContext())).Status);
        state.MarkRunning();
        Assert.Equal(HealthStatus.Unhealthy, (await check.CheckHealthAsync(new HealthCheckContext())).Status);
        state.MarkReady([]);
        Assert.Equal(HealthStatus.Healthy, (await check.CheckHealthAsync(new HealthCheckContext())).Status);
    }

    // ---------- the steps ----------

    private sealed class FakeConfigurationManager : IConfigurationManager<OpenIdConnectConfiguration>
    {
        public int Fetches { get; private set; }

        public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel)
        {
            Fetches++;
            return Task.FromResult(new OpenIdConnectConfiguration());
        }

        public void RequestRefresh()
        {
        }
    }

    [Fact]
    public async Task AuthMetadata_AsksTheRegisteredSchemesConfigurationManager_AndCreatesNoToken()
    {
        var manager = new FakeConfigurationManager();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options => options.ConfigurationManager = manager);
        await using var provider = services.BuildServiceProvider();
        var task = new AuthMetadataWarmupTask(new CapturingLogger<AuthMetadataWarmupTask>());

        await task.RunAsync(provider, CancellationToken.None);

        Assert.Equal(1, manager.Fetches);
        Assert.Equal(WarmupCriticality.Critical, task.Criticality);
    }

    [Fact]
    public async Task AuthMetadata_WithoutAnAuthenticationScheme_DoesNothing()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthentication();
        await using var provider = services.BuildServiceProvider();

        await new AuthMetadataWarmupTask(new CapturingLogger<AuthMetadataWarmupTask>()).RunAsync(provider, CancellationToken.None);
    }

    private sealed class RecordingConnection(Func<Task> onOpen) : DbConnection
    {
        public bool Disposed { get; private set; }

        public override string ConnectionString { get; set; } = "";

        public override string Database => "";

        public override string DataSource => "";

        public override string ServerVersion => "";

        public override ConnectionState State => ConnectionState.Closed;

        public override void ChangeDatabase(string databaseName)
        {
        }

        public override void Close()
        {
        }

        public override void Open() => throw new NotSupportedException();

        public override Task OpenAsync(CancellationToken cancellationToken) => onOpen();

        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => throw new NotSupportedException();

        protected override DbCommand CreateDbCommand() => throw new NotSupportedException();

        public override ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    [Fact]
    public async Task ConnectionPool_OpensAllConnectionsAtTheSameTime_ThenReleasesThemAll()
    {
        var opening = 0;
        var maxAtOnce = 0;
        var created = new List<RecordingConnection>();
        var release = new TaskCompletionSource();

        var warming = SqlConnectionPoolWarmer.WarmAsync(
            "Server=x",
            4,
            _ =>
            {
                var connection = new RecordingConnection(async () =>
                {
                    var now = Interlocked.Increment(ref opening);
                    InterlockedMax(ref maxAtOnce, now);
                    // Every open waits for the others: only truly simultaneous opens can all get past this.
                    if (now == 4)
                    {
                        release.TrySetResult();
                    }

                    await release.Task;
                });
                created.Add(connection);
                return connection;
            },
            CancellationToken.None);
        var finished = await Task.WhenAny(warming, Task.Delay(TimeSpan.FromSeconds(5)));

        Assert.Same(warming, finished);
        Assert.Equal(4, await warming);
        Assert.Equal(4, maxAtOnce);
        Assert.All(created, connection => Assert.True(connection.Disposed));
    }

    [Fact]
    public async Task ConnectionPool_AFailedOpen_StillReleasesEveryConnection_AndFails()
    {
        var created = new List<RecordingConnection>();

        await Assert.ThrowsAnyAsync<Exception>(() => SqlConnectionPoolWarmer.WarmAsync(
            "Server=x",
            3,
            _ =>
            {
                var index = created.Count;
                var connection = new RecordingConnection(() => index == 1 ? throw new InvalidOperationException("login failed") : Task.CompletedTask);
                created.Add(connection);
                return connection;
            },
            CancellationToken.None));

        Assert.Equal(3, created.Count);
        Assert.All(created, connection => Assert.True(connection.Disposed));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-3, 0)]
    [InlineData(4, 4)]
    [InlineData(500, SqlConnectionPoolWarmer.MaxCount)]
    public async Task ConnectionPool_CountIsClamped(int requested, int expected)
    {
        var created = 0;

        var opened = await SqlConnectionPoolWarmer.WarmAsync("Server=x", requested, _ =>
        {
            Interlocked.Increment(ref created);
            return new RecordingConnection(() => Task.CompletedTask);
        }, CancellationToken.None);

        Assert.Equal(expected, opened);
        Assert.Equal(expected, created);
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        do
        {
            current = Volatile.Read(ref target);
            if (value <= current)
            {
                return;
            }
        }
        while (Interlocked.CompareExchange(ref target, value, current) != current);
    }

    private static JupleDbContext NoDatabaseContext(out RequestSqlTiming timing, out IDisposable scope)
    {
        // Nothing listens here: any attempt to open a connection or run a command would fail or be counted.
        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer("Server=127.0.0.1,1;Database=none;User Id=u;Password=p;Connect Timeout=1;Encrypt=False")
            .AddInterceptors(new RequestConnectionTimingInterceptor(), new RequestSqlTimingInterceptor())
            .Options;
        scope = RequestSqlTimingScope.Begin(out timing);
        return new JupleDbContext(options);
    }

    [Fact]
    public async Task EfModel_BuildsTheModel_WithoutOpeningAConnection()
    {
        await using var db = NoDatabaseContext(out var timing, out var scope);
        using var _ = scope;
        var services = new ServiceCollection().AddSingleton(db).BuildServiceProvider();

        await new EfModelWarmupTask(new CapturingLogger<EfModelWarmupTask>()).RunAsync(services, CancellationToken.None);

        Assert.Equal(0, timing.ConnectionSnapshot().Opens);
        Assert.Equal(0, timing.Snapshot().Commands);
    }

    [Fact]
    public async Task EveryHotQueryShape_Translates_WithoutAConnection_ACommand_OrAnyPersonsId()
    {
        await using var db = NoDatabaseContext(out var timing, out var scope);
        using var _ = scope;
        var queries = new HotQueryWarmupSource(db).Queries();

        Assert.True(queries.Count >= 8);
        Assert.Equal(queries.Count, queries.Select(query => query.Name).Distinct().Count());
        foreach (var query in queries)
        {
            var sink = new QueryTranslationSink();
            await query.Translate(sink, CancellationToken.None);
            Assert.True(sink.Captured >= 1, query.Name);
        }

        Assert.Equal(0, timing.ConnectionSnapshot().Opens);
        Assert.Equal(0, timing.Snapshot().Commands);
        Assert.Contains(queries, query => query.Name == "HomeSummary");
        Assert.Contains(queries, query => query.Name == "HomeHistory");
        Assert.DoesNotContain(queries, query => query.Name.Contains("Name", StringComparison.Ordinal) && query.Name.Contains("Sort", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TheQueryStep_LogsEachShapeByNameOnly_AndAFailedShapeDoesNotStopTheOthers()
    {
        var source = new ThrowingSource();
        var services = new ServiceCollection().AddSingleton<IQueryWarmupSource>(source).BuildServiceProvider();
        var logger = new CapturingLogger<QueryCompilationWarmupTask>();

        await Assert.ThrowsAsync<InvalidOperationException>(() => new QueryCompilationWarmupTask(logger).RunAsync(services, CancellationToken.None));

        Assert.Equal(2, source.Ran);
        Assert.Contains(logger.Entries, entry => entry.Message.Contains("Query=Good Statements=0", StringComparison.Ordinal));
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Warning && entry.Message.Contains("Query=Bad Result=Failed", StringComparison.Ordinal));
        Assert.DoesNotContain(logger.Entries, entry => entry.Message.Contains("SELECT", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(WarmupCriticality.BestEffort, new QueryCompilationWarmupTask(logger).Criticality);
    }

    private sealed class ThrowingSource : IQueryWarmupSource
    {
        public int Ran { get; private set; }

        public IReadOnlyList<QueryWarmup> Queries() =>
        [
            new("Bad", (_, _) =>
            {
                Ran++;
                throw new InvalidOperationException("SELECT secret FROM x");
            }),
            new("Good", (sink, _) =>
            {
                Ran++;
                return Task.CompletedTask;
            }),
        ];
    }

    [Fact]
    public void Options_AreOffByDefault_WithSmallSafeNumbers()
    {
        var options = new StartupWarmupOptions();

        Assert.False(options.Enabled);
        Assert.Equal(4, options.ConnectionPoolSize);
        Assert.InRange(options.TimeoutSeconds, 20, 60);
        Assert.InRange(options.CriticalRetries, 0, 3);
    }
}
