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
/// What the timing middleware and the two authentication marks share for ONE request (kept in <c>HttpContext.Items</c>, so
/// concurrent requests can never mix). Only timestamps - nothing about the caller.
/// </summary>
public sealed class RequestTimingState
{
    public const string ItemKey = "Juple.RequestTiming";

    public long StartTimestamp { get; init; }

    public long AuthStartTimestamp { get; set; }

    public long AuthEndTimestamp { get; set; }
}

/// <summary>
/// The two marks around <c>UseAuthentication</c> (registered only while request timing is on). They never run authentication
/// themselves and change nothing about it - they only read the clock: the time between them is the authentication middleware's own
/// work (token validation, the signing-key / metadata lookup it may wait for), up to the moment the rest of the pipeline begins.
/// </summary>
public static class RequestTimingMarks
{
    public static Task BeforeAuthentication(HttpContext context, Func<Task> next)
    {
        if (context.Items.TryGetValue(RequestTimingState.ItemKey, out var state) && state is RequestTimingState timing)
        {
            timing.AuthStartTimestamp = Stopwatch.GetTimestamp();
        }

        return next();
    }

    public static Task AfterAuthentication(HttpContext context, Func<Task> next)
    {
        if (context.Items.TryGetValue(RequestTimingState.ItemKey, out var state) && state is RequestTimingState timing)
        {
            timing.AuthEndTimestamp = Stopwatch.GetTimestamp();
        }

        return next();
    }
}

/// <summary>
/// One structured line per request: HTTP method, ROUTE TEMPLATE (never the real path, so no collection / item / user id), status,
/// elapsed milliseconds, and where that time went - authentication, database connection opens, SQL commands (count, total, longest) -
/// plus the trace id. Nothing else: no query string, header, body, user, token or connection detail. The line is the Juple-specific
/// alternative to switching on the framework's noisy request log.
///
/// Fields (all numbers are milliseconds unless a count):
///  - ElapsedMs: the whole request as this middleware sees it (it is the outermost one).
///  - PreAuthMs: start of the request until authentication begins (HTTPS redirect, CORS). -1: authentication never ran.
///  - AuthMs: the authentication middleware. -1: it did not complete (the request ended earlier).
///  - ConnOpens / ConnOpenTotalMs / ConnOpenMaxMs: database connection opens - a pooled open is what it really took (usually ~0), a
///    new physical connection includes its network round trips and login.
///  - SqlCommands / SqlTotalMs / SqlMaxMs: command execution only (EF's own "Executed DbCommand (Nms)" figure).
///  - OtherMs: ElapsedMs - AuthMs - PreAuthMs - ConnOpenTotalMs - SqlTotalMs, i.e. everything not accounted for (controller / service
///    code, serialization, thread-pool waits ...). Only written as a number when those parts cannot overlap-inflate it: a request that
///    ran database work in parallel can have its parts sum to more than the elapsed time, and then it is -1 (not a guess).
///  - Slow requests only (>= the threshold, the Warning lines): thread pool state AT THE END of the request - ThreadPoolThreads,
///    ThreadPoolBusy, ThreadPoolPending. They are process-wide and observed when the request finishes, so they hint at pressure, not
///    prove a stall during that request.
///
/// Answers "Request 820 ms, 4 SQL commands, 610 ms in SQL, longest 420 ms" - and, when SQL is small, whether the rest was
/// authentication, waiting for a connection, or neither. The SQL / connection figures are summed per request through
/// <see cref="RequestSqlTimingScope"/>.
/// </summary>
public sealed class RequestTimingMiddleware(RequestDelegate next, ILogger<RequestTimingMiddleware> logger, IOptions<RequestTimingOptions> options)
{
    // Frequent platform probes (/health liveness, /health/ready readiness) - not user requests.
    private const string HealthPath = "/health";

    private readonly int _slowThresholdMs = Math.Max(1, options.Value.SlowRequestThresholdMs);

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path.StartsWithSegments(HealthPath, StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var state = new RequestTimingState { StartTimestamp = Stopwatch.GetTimestamp() };
        context.Items[RequestTimingState.ItemKey] = state;
        using var sqlScope = RequestSqlTimingScope.Begin(out var sql);
        try
        {
            await next(context);
        }
        finally
        {
            Log(context, state, Stopwatch.GetElapsedTime(state.StartTimestamp), sql);
        }
    }

    /// <summary>The figures of one request, derived from raw measurements. Pure - unit tested.</summary>
    public static RequestTimingFigures Figures(
        TimeSpan elapsed,
        long startTimestamp,
        long authStartTimestamp,
        long authEndTimestamp,
        (int Opens, double TotalMs, double MaxMs) connection,
        (int Commands, double TotalMs, double MaxMs) sql)
    {
        var elapsedMs = (int)Math.Round(elapsed.TotalMilliseconds);
        var authRan = authStartTimestamp != 0 && authEndTimestamp >= authStartTimestamp;
        var preAuthMs = authStartTimestamp != 0 ? (int)Math.Round(Stopwatch.GetElapsedTime(startTimestamp, authStartTimestamp).TotalMilliseconds) : -1;
        var authMs = authRan ? (int)Math.Round(Stopwatch.GetElapsedTime(authStartTimestamp, authEndTimestamp).TotalMilliseconds) : -1;
        var connTotal = (int)Math.Round(connection.TotalMs);
        var sqlTotal = (int)Math.Round(sql.TotalMs);

        // OtherMs only when the accounted parts are measured and cannot exceed the whole: otherwise -1.
        var accounted = Math.Max(preAuthMs, 0) + Math.Max(authMs, 0) + connTotal + sqlTotal;
        var otherMs = authRan && accounted <= elapsedMs ? elapsedMs - accounted : -1;

        return new RequestTimingFigures(
            elapsedMs, preAuthMs, authMs, connection.Opens, connTotal, (int)Math.Round(connection.MaxMs),
            sql.Commands, sqlTotal, (int)Math.Round(sql.MaxMs), otherMs);
    }

    private void Log(HttpContext context, RequestTimingState state, TimeSpan elapsed, RequestSqlTiming sql)
    {
        var figures = Figures(elapsed, state.StartTimestamp, state.AuthStartTimestamp, state.AuthEndTimestamp, sql.ConnectionSnapshot(), sql.Snapshot());
        var method = context.Request.Method;
        var route = RouteOf(context);
        var status = context.Response.StatusCode;
        var traceId = Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier;

        if (figures.ElapsedMs < _slowThresholdMs)
        {
            logger.LogInformation(
                "WebRequestTiming Method={Method} Route={Route} Status={Status} ElapsedMs={ElapsedMs} PreAuthMs={PreAuthMs} AuthMs={AuthMs} ConnOpens={ConnOpens} ConnOpenTotalMs={ConnOpenTotalMs} ConnOpenMaxMs={ConnOpenMaxMs} SqlCommands={SqlCommands} SqlTotalMs={SqlTotalMs} SqlMaxMs={SqlMaxMs} OtherMs={OtherMs} TraceId={TraceId}",
                method, route, status, figures.ElapsedMs, figures.PreAuthMs, figures.AuthMs, figures.ConnOpens, figures.ConnOpenTotalMs, figures.ConnOpenMaxMs,
                figures.SqlCommands, figures.SqlTotalMs, figures.SqlMaxMs, figures.OtherMs, traceId);
            return;
        }

        // Slow: the same fields, then the thread pool as it is now (see the class remarks).
        ThreadPool.GetMaxThreads(out var maxWorkers, out _);
        ThreadPool.GetAvailableThreads(out var availableWorkers, out _);
        logger.LogWarning(
            "WebRequestTiming Method={Method} Route={Route} Status={Status} ElapsedMs={ElapsedMs} PreAuthMs={PreAuthMs} AuthMs={AuthMs} ConnOpens={ConnOpens} ConnOpenTotalMs={ConnOpenTotalMs} ConnOpenMaxMs={ConnOpenMaxMs} SqlCommands={SqlCommands} SqlTotalMs={SqlTotalMs} SqlMaxMs={SqlMaxMs} OtherMs={OtherMs} TraceId={TraceId} ThreadPoolThreads={ThreadPoolThreads} ThreadPoolBusy={ThreadPoolBusy} ThreadPoolPending={ThreadPoolPending}",
            method, route, status, figures.ElapsedMs, figures.PreAuthMs, figures.AuthMs, figures.ConnOpens, figures.ConnOpenTotalMs, figures.ConnOpenMaxMs,
            figures.SqlCommands, figures.SqlTotalMs, figures.SqlMaxMs, figures.OtherMs, traceId,
            ThreadPool.ThreadCount, maxWorkers - availableWorkers, ThreadPool.PendingWorkItemCount);
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

/// <summary>The derived figures of one request (see <see cref="RequestTimingMiddleware"/>); -1 = not measured / not meaningful.</summary>
public readonly record struct RequestTimingFigures(
    int ElapsedMs,
    int PreAuthMs,
    int AuthMs,
    int ConnOpens,
    int ConnOpenTotalMs,
    int ConnOpenMaxMs,
    int SqlCommands,
    int SqlTotalMs,
    int SqlMaxMs,
    int OtherMs);
