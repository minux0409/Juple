using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence.Warmup;

/// <summary>
/// Collects queries instead of running them: <see cref="Capture"/> makes EF translate the query to SQL (<c>ToQueryString</c>) and
/// drops the text. No connection is opened and nothing is read from the database - so a query can be warmed (its expression
/// translated, the code paths it uses compiled) without touching any person's data.
///
/// A store that owns a hot query takes an optional sink in an internal "core" method: when a sink is given, the method builds the SAME
/// expression it runs for real, hands it to the sink at the point where it would be executed, and returns an empty result. So the
/// warm-up and the runtime can never drift apart into two copies of one LINQ query.
/// </summary>
public sealed class QueryTranslationSink
{
    public int Captured { get; private set; }

    public void Capture(IQueryable query)
    {
        // The text itself is discarded (it could never be logged anyway: parameters are placeholders, the shape is code).
        _ = query.ToQueryString();
        Captured++;
    }
}

/// <summary>One query shape to warm: a stable name for the timing log, and what translates it.</summary>
public sealed record QueryWarmup(string Name, Func<QueryTranslationSink, CancellationToken, Task> Translate);

/// <summary>The hot query shapes of the signed-in app, in the order they are warmed.</summary>
public interface IQueryWarmupSource
{
    IReadOnlyList<QueryWarmup> Queries();
}
