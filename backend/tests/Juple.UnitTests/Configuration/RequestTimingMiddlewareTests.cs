using Juple.Api.Diagnostics;
using Juple.Infrastructure.Persistence.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
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
}
