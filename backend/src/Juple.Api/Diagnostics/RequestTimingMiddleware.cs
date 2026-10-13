using System.Diagnostics;
using Juple.Infrastructure.Persistence.Diagnostics;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;

namespace Juple.Api.Diagnostics;

/// <summary>
/// Bound from the "RequestTiming" configuration section. OFF by default (Production never turns it on by default); a Dev deployment
/// enables it through configuration only. See <see cref="RequestTimingMiddleware"/>.
/// </summary>
public sealed class RequestTimingOptions
{
    public const string SectionName = "RequestTiming";

    public bool Enabled { get; set; }

    /// <summary>A request at or above this many milliseconds is logged as a Warning instead of Information.</summary>
    public int SlowRequestThresholdMs { get; set; } = 500;
}

/// <summary>
/// One structured line per request: HTTP method, ROUTE TEMPLATE (never the real path, so no collection / item / user id), status,
/// elapsed milliseconds, and what that request's SQL commands added up to (count, total, longest) plus the trace id. Nothing else:
/// no query string, header, body, user or token. The line is the Juple-specific alternative to switching on the framework's
/// noisy request log.
///
/// Answers "Request 820 ms, 4 SQL commands, 610 ms in SQL, longest 420 ms" for a slow request. The SQL figures are the same
/// durations EF logs as "Executed DbCommand (Nms)", summed per request through <see cref="RequestSqlTimingScope"/>.
/// </summary>
public sealed class RequestTimingMiddleware(RequestDelegate next, ILogger<RequestTimingMiddleware> logger, IOptions<RequestTimingOptions> options)
{
    // Frequent platform probes - not user requests.
    private const string HealthPath = "/health";

    private readonly int _slowThresholdMs = Math.Max(1, options.Value.SlowRequestThresholdMs);

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path.Equals(HealthPath, StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var started = Stopwatch.GetTimestamp();
        using var sqlScope = RequestSqlTimingScope.Begin(out var sql);
        try
        {
            await next(context);
        }
        finally
        {
            var elapsed = Stopwatch.GetElapsedTime(started);
            Log(context, elapsed, sql);
        }
    }

    private void Log(HttpContext context, TimeSpan elapsed, RequestSqlTiming sql)
    {
        var elapsedMs = (int)Math.Round(elapsed.TotalMilliseconds);
        var (commands, totalMs, maxMs) = sql.Snapshot();
        var method = context.Request.Method;
        var route = RouteOf(context);
        var status = context.Response.StatusCode;
        var traceId = Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier;
        var level = elapsedMs >= _slowThresholdMs ? LogLevel.Warning : LogLevel.Information;

        logger.Log(
            level,
            "WebRequestTiming Method={Method} Route={Route} Status={Status} ElapsedMs={ElapsedMs} SqlCommands={SqlCommands} SqlTotalMs={SqlTotalMs} SqlMaxMs={SqlMaxMs} TraceId={TraceId}",
            method,
            route,
            status,
            elapsedMs,
            commands,
            (int)Math.Round(totalMs),
            (int)Math.Round(maxMs),
            traceId);
    }

    /// <summary>
    /// The matched route's TEMPLATE. A request that matched no endpoint (a CORS preflight answered by the CORS middleware, a 404)
    /// is a fixed label - its raw path could be anything a caller typed.
    /// </summary>
    private static string RouteOf(HttpContext context)
    {
        if (context.GetEndpoint() is RouteEndpoint endpoint && endpoint.RoutePattern.RawText is { Length: > 0 } template)
        {
            return template.StartsWith('/') ? template : "/" + template;
        }

        return HttpMethods.IsOptions(context.Request.Method) ? "(preflight)" : "(unmatched)";
    }
}
