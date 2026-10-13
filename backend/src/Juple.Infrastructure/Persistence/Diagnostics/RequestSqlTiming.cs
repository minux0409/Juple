using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.Infrastructure.Persistence.Diagnostics;

/// <summary>
/// What one HTTP request's SQL commands added up to: how many, their total and the longest. Only numbers - never the command text or
/// its parameters (a request-timing log must not carry data).
/// </summary>
public sealed class RequestSqlTiming
{
    private readonly object _gate = new();
    private int _commands;
    private double _totalMs;
    private double _maxMs;

    public void Record(TimeSpan duration)
    {
        var ms = duration.TotalMilliseconds;
        lock (_gate)
        {
            _commands++;
            _totalMs += ms;
            if (ms > _maxMs)
            {
                _maxMs = ms;
            }
        }
    }

    public (int Commands, double TotalMs, double MaxMs) Snapshot()
    {
        lock (_gate)
        {
            return (_commands, _totalMs, _maxMs);
        }
    }
}

/// <summary>
/// The ambient accumulator of the request being timed. It flows with the request's async context, so the EF interceptor needs no
/// reference to the HTTP layer. Nothing is set unless the API's request timing is enabled - then <see cref="Current"/> is null and the
/// interceptor does nothing.
/// </summary>
public static class RequestSqlTimingScope
{
    private static readonly AsyncLocal<RequestSqlTiming?> CurrentTiming = new();

    public static RequestSqlTiming? Current => CurrentTiming.Value;

    /// <summary>Starts collecting for the current async flow; dispose to stop.</summary>
    public static IDisposable Begin(out RequestSqlTiming timing)
    {
        timing = new RequestSqlTiming();
        CurrentTiming.Value = timing;
        return new Scope();
    }

    private sealed class Scope : IDisposable
    {
        public void Dispose() => CurrentTiming.Value = null;
    }
}

/// <summary>
/// Adds each executed command's duration (the same figure EF's own "Executed DbCommand (Nms)" line reports) to the current request's
/// <see cref="RequestSqlTiming"/>. Registered always; with no request being timed (every other host: Jobs, workers, a disabled
/// timing) it is one null check.
/// </summary>
public sealed class RequestSqlTimingInterceptor : DbCommandInterceptor
{
    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    {
        Record(eventData);
        return result;
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
    {
        Record(eventData);
        return ValueTask.FromResult(result);
    }

    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    {
        Record(eventData);
        return result;
    }

    public override ValueTask<int> NonQueryExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Record(eventData);
        return ValueTask.FromResult(result);
    }

    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        Record(eventData);
        return result;
    }

    public override ValueTask<object?> ScalarExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, object? result, CancellationToken cancellationToken = default)
    {
        Record(eventData);
        return ValueTask.FromResult(result);
    }

    private static void Record(CommandExecutedEventData eventData) => RequestSqlTimingScope.Current?.Record(eventData.Duration);
}
