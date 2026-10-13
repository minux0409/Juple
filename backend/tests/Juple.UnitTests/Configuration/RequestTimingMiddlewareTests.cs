using System.Diagnostics;
using Juple.Api.Diagnostics;
using Juple.Infrastructure.Persistence.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Configuration;

/// <summary>The per-request timing line: route TEMPLATE only, status, elapsed, SQL totals - and nothing a caller could have put in.</summary>
public sealed class RequestTimingMiddlewareTests
{
    private sealed record Entry(LogLevel Level, string Message);

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<Entry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add(new Entry(logLevel, formatter(state, exception)));
    }

    private static DefaultHttpContext ContextFor(string method, string path, string? routeTemplate, int status = 200)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.QueryString = new QueryString("?q=secret-search-term");
        context.Request.Headers.Authorization = "Bearer secret-token-value";
        context.Response.StatusCode = status;
        if (routeTemplate is not null)
        {
            var endpoint = new RouteEndpoint(
                _ => Task.CompletedTask,
                RoutePatternFactory.Parse(routeTemplate),
                order: 0,
                metadata: EndpointMetadataCollection.Empty,
                displayName: "test");
            context.SetEndpoint(endpoint);
        }

        return context;
    }

    private static (RequestTimingMiddleware Middleware, CapturingLogger<RequestTimingMiddleware> Logger) Create(
        RequestDelegate next, int thresholdMs = 500)
    {
        var logger = new CapturingLogger<RequestTimingMiddleware>();
        var options = Options.Create(new RequestTimingOptions { Enabled = true, SlowRequestThresholdMs = thresholdMs });
        return (new RequestTimingMiddleware(next, logger, options), logger);
    }

    [Fact]
    public async Task LogsTheRouteTemplate_NeverTheRealPathQueryOrHeaders()
    {
        var (middleware, logger) = Create(_ => Task.CompletedTask);
        var context = ContextFor("GET", "/api/v1/collections/987654/items", "api/v1/collections/{collectionId}/items");

        await middleware.InvokeAsync(context);

        var line = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("Method=GET", line.Message, StringComparison.Ordinal);
        Assert.Contains("Route=/api/v1/collections/{collectionId}/items", line.Message, StringComparison.Ordinal);
        Assert.Contains("Status=200", line.Message, StringComparison.Ordinal);
        Assert.Contains("ElapsedMs=", line.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("987654", line.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-search-term", line.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-token-value", line.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SumsTheSqlCommandsOfTheRequest()
    {
        var (middleware, logger) = Create(_ =>
        {
            RequestSqlTimingScope.Current!.Record(TimeSpan.FromMilliseconds(10));
            RequestSqlTimingScope.Current!.Record(TimeSpan.FromMilliseconds(420));
            RequestSqlTimingScope.Current!.Record(TimeSpan.FromMilliseconds(30));
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(ContextFor("GET", "/api/v1/items/history", "api/v1/items/history"));

        var line = Assert.Single(logger.Entries).Message;
        Assert.Contains("SqlCommands=3", line, StringComparison.Ordinal);
        Assert.Contains("SqlTotalMs=460", line, StringComparison.Ordinal);
        Assert.Contains("SqlMaxMs=420", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AccumulatorDoesNotLeakIntoTheNextRequest()
    {
        var (middleware, logger) = Create(_ =>
        {
            RequestSqlTimingScope.Current!.Record(TimeSpan.FromMilliseconds(5));
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(ContextFor("GET", "/a", "a"));

        Assert.Null(RequestSqlTimingScope.Current);
        Assert.Single(logger.Entries);
    }

    [Fact]
    public async Task ASlowRequest_IsAWarning_AFastOneIsInformation()
    {
        var (slow, slowLogger) = Create(async _ => await Task.Delay(60), thresholdMs: 50);
        await slow.InvokeAsync(ContextFor("GET", "/x", "x"));
        Assert.Equal(LogLevel.Warning, Assert.Single(slowLogger.Entries).Level);

        var (fast, fastLogger) = Create(_ => Task.CompletedTask, thresholdMs: 60_000);
        await fast.InvokeAsync(ContextFor("GET", "/x", "x"));
        Assert.Equal(LogLevel.Information, Assert.Single(fastLogger.Entries).Level);
    }

    [Fact]
    public async Task AnUnmatchedRequest_GetsAFixedLabel_NotItsRawPath()
    {
        var (middleware, logger) = Create(_ => Task.CompletedTask);

        await middleware.InvokeAsync(ContextFor("GET", "/api/v1/whatever/12345", routeTemplate: null, status: 404));
        await middleware.InvokeAsync(ContextFor("OPTIONS", "/api/v1/items/history", routeTemplate: null, status: 204));

        Assert.Contains("Route=(unmatched)", logger.Entries[0].Message, StringComparison.Ordinal);
        Assert.DoesNotContain("12345", logger.Entries[0].Message, StringComparison.Ordinal);
        Assert.Contains("Route=(preflight)", logger.Entries[1].Message, StringComparison.Ordinal);
        Assert.Contains("Status=404", logger.Entries[0].Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheHealthProbe_IsNotLogged()
    {
        var (middleware, logger) = Create(_ => Task.CompletedTask);

        await middleware.InvokeAsync(ContextFor("GET", "/health", "health"));

        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task AFailingRequest_IsStillTimed()
    {
        var (middleware, logger) = Create(_ => throw new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(ContextFor("POST", "/p", "p")));

        Assert.Single(logger.Entries);
    }

    [Fact]
    public void Options_AreOffByDefault()
    {
        var options = new RequestTimingOptions();

        Assert.False(options.Enabled);
        Assert.Equal(500, options.SlowRequestThresholdMs);
    }

    // ---------- connection / authentication timing ----------

    [Fact]
    public async Task SumsTheConnectionOpensOfTheRequest_CountTotalAndMax()
    {
        var (middleware, logger) = Create(_ =>
        {
            RequestSqlTimingScope.Current!.RecordConnectionOpen(TimeSpan.FromMilliseconds(2));
            RequestSqlTimingScope.Current!.RecordConnectionOpen(TimeSpan.FromMilliseconds(610));
            RequestSqlTimingScope.Current!.RecordConnectionOpen(TimeSpan.FromMilliseconds(3));
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(ContextFor("GET", "/api/v1/x", "api/v1/x"));

        var line = Assert.Single(logger.Entries).Message;
        Assert.Contains("ConnOpens=3", line, StringComparison.Ordinal);
        Assert.Contains("ConnOpenTotalMs=615", line, StringComparison.Ordinal);
        Assert.Contains("ConnOpenMaxMs=610", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AuthenticationTime_IsMeasuredBetweenTheTwoMarks_AndNeverMixesBetweenConcurrentRequests()
    {
        // Two requests at once: one spends ~120 ms in authentication, the other ~0. Each line must carry its own.
        var (middleware, logger) = Create(async context =>
        {
            await RequestTimingMarks.BeforeAuthentication(context, () => Task.CompletedTask);
            await Task.Delay(context.Request.Path == "/slow" ? 120 : 0);
            await RequestTimingMarks.AfterAuthentication(context, () => Task.CompletedTask);
            RequestSqlTimingScope.Current!.RecordConnectionOpen(TimeSpan.FromMilliseconds(context.Request.Path == "/slow" ? 7 : 1));
        });

        await Task.WhenAll(
            middleware.InvokeAsync(ContextFor("GET", "/slow", "slow")),
            middleware.InvokeAsync(ContextFor("GET", "/fast", "fast")));

        var slow = logger.Entries.Single(entry => entry.Message.Contains("Route=/slow", StringComparison.Ordinal)).Message;
        var fast = logger.Entries.Single(entry => entry.Message.Contains("Route=/fast", StringComparison.Ordinal)).Message;
        Assert.InRange(ValueOf(slow, "AuthMs"), 100, 400);
        Assert.InRange(ValueOf(fast, "AuthMs"), 0, 60);
        Assert.Equal(7, ValueOf(slow, "ConnOpenTotalMs"));
        Assert.Equal(1, ValueOf(fast, "ConnOpenTotalMs"));
    }

    [Fact]
    public async Task WithoutTheAuthenticationMarks_AuthAndOtherAreMinusOne_NotAGuess()
    {
        var (middleware, logger) = Create(_ => Task.CompletedTask);

        await middleware.InvokeAsync(ContextFor("GET", "/x", "x"));

        var line = Assert.Single(logger.Entries).Message;
        Assert.Equal(-1, ValueOf(line, "AuthMs"));
        Assert.Equal(-1, ValueOf(line, "PreAuthMs"));
        Assert.Equal(-1, ValueOf(line, "OtherMs"));
    }

    [Fact]
    public void Figures_OtherIsWhatIsLeft_AndMinusOneWhenThePartsOverlap()
    {
        var start = Stopwatch.GetTimestamp();
        var authStart = start + Stopwatch.Frequency / 100;      // 10 ms in
        var authEnd = authStart + Stopwatch.Frequency / 50;     // 20 ms of authentication

        var ok = RequestTimingMiddleware.Figures(TimeSpan.FromMilliseconds(900), start, authStart, authEnd, (1, 600, 600), (2, 40, 30));
        Assert.Equal(900, ok.ElapsedMs);
        Assert.Equal(10, ok.PreAuthMs);
        Assert.Equal(20, ok.AuthMs);
        Assert.Equal(600, ok.ConnOpenTotalMs);
        Assert.Equal(40, ok.SqlTotalMs);
        Assert.Equal(900 - 10 - 20 - 600 - 40, ok.OtherMs);

        // The parts add up to more than the whole (database work in parallel inside one request): not a number.
        var overlapped = RequestTimingMiddleware.Figures(TimeSpan.FromMilliseconds(300), start, authStart, authEnd, (2, 250, 200), (2, 200, 150));
        Assert.Equal(-1, overlapped.OtherMs);
    }

    [Fact]
    public async Task ASlowRequest_AddsTheThreadPoolState_AFastOneDoesNot()
    {
        var (slow, slowLogger) = Create(async _ => await Task.Delay(40), thresholdMs: 20);
        await slow.InvokeAsync(ContextFor("GET", "/s", "s"));
        var slowLine = Assert.Single(slowLogger.Entries).Message;
        Assert.Contains("ThreadPoolThreads=", slowLine, StringComparison.Ordinal);
        Assert.Contains("ThreadPoolBusy=", slowLine, StringComparison.Ordinal);
        Assert.Contains("ThreadPoolPending=", slowLine, StringComparison.Ordinal);

        var (fast, fastLogger) = Create(_ => Task.CompletedTask, thresholdMs: 60_000);
        await fast.InvokeAsync(ContextFor("GET", "/f", "f"));
        Assert.DoesNotContain("ThreadPool", Assert.Single(fastLogger.Entries).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARequestWithNoDatabaseWork_ReportsZeroConnections_AndTheOriginalFieldsRemain()
    {
        var (middleware, logger) = Create(_ => Task.CompletedTask);

        await middleware.InvokeAsync(ContextFor("GET", "/api/v1/a", "api/v1/a"));

        var line = Assert.Single(logger.Entries).Message;
        foreach (var field in new[] { "Method=", "Route=", "Status=", "ElapsedMs=", "SqlCommands=", "SqlTotalMs=", "SqlMaxMs=", "TraceId=" })
        {
            Assert.Contains(field, line, StringComparison.Ordinal);
        }

        Assert.Contains("ConnOpens=0", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AFailedConnectionOpen_IsStillCounted_AndTheScopeIsCleanedUp()
    {
        // Nothing listens on this port: the open fails at once. The failed attempt's wait is part of the request's connection time.
        var options = new DbContextOptionsBuilder<DbContext>()
            .UseSqlServer("Server=127.0.0.1,1;Database=none;User Id=u;Password=p;Connect Timeout=2;Encrypt=False")
            .AddInterceptors(new RequestConnectionTimingInterceptor(), new RequestSqlTimingInterceptor())
            .Options;
        var (middleware, logger) = Create(async _ =>
        {
            await using var db = new DbContext(options);
            await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlRawAsync("SELECT 1"));
        });

        await middleware.InvokeAsync(ContextFor("GET", "/api/v1/db", "api/v1/db"));

        var line = Assert.Single(logger.Entries).Message;
        Assert.True(ValueOf(line, "ConnOpens") >= 1, line);
        Assert.Equal(0, ValueOf(line, "SqlCommands"));
        Assert.Null(RequestSqlTimingScope.Current);
    }

    [Fact]
    public async Task NothingSensitiveIsLogged_EvenWithConnectionAndAuthenticationFields()
    {
        var (middleware, logger) = Create(async context =>
        {
            await RequestTimingMarks.BeforeAuthentication(context, () => Task.CompletedTask);
            await RequestTimingMarks.AfterAuthentication(context, () => Task.CompletedTask);
            RequestSqlTimingScope.Current!.RecordConnectionOpen(TimeSpan.FromMilliseconds(5));
        });
        var context = ContextFor("GET", "/api/v1/collections/987654/items", "api/v1/collections/{collectionId}/items");

        await middleware.InvokeAsync(context);

        var line = Assert.Single(logger.Entries).Message;
        Assert.DoesNotContain("987654", line, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-token-value", line, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-search-term", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Server=", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Database=", line, StringComparison.Ordinal);
    }

    private static int ValueOf(string line, string field)
    {
        var start = line.IndexOf(" " + field + "=", StringComparison.Ordinal) + field.Length + 2;
        var end = line.IndexOf(' ', start);
        return int.Parse(end < 0 ? line[start..] : line[start..end], System.Globalization.CultureInfo.InvariantCulture);
    }
}
