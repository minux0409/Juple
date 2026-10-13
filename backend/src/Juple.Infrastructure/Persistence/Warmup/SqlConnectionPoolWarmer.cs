using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence.Warmup;

/// <summary>
/// Puts several physical connections into the SQL connection pool before the first user needs them. The first wave of requests after a
/// start opens as many connections at once as it has parallel database requests, and each new physical connection (network round
/// trips and login) cost 0.5-1.2 s on Dev. Opening ONE connection and closing it would leave a single pooled connection; so
/// <paramref name="count"/> connections are opened AT THE SAME TIME, all kept open until every one succeeded, then returned to the pool.
/// They are ordinary pooled connections (same connection string, so the same pool the application uses); nothing is executed on them.
/// The pool's own idle pruning still applies later - this prepares the START, it does not keep connections forever.
/// </summary>
public static class SqlConnectionPoolWarmer
{
    /// <summary>The most connections ever warmed (the pool's default maximum is 100; this is a start-up nudge, not a reservation).</summary>
    public const int MaxCount = 16;

    public static Task<int> WarmAsync(JupleDbContext dbContext, int count, CancellationToken cancellationToken) =>
        WarmAsync(
            dbContext.Database.GetConnectionString() ?? throw new InvalidOperationException("The database connection is not configured."),
            count,
            connectionString => new SqlConnection(connectionString),
            cancellationToken);

    public static async Task<int> WarmAsync(
        string connectionString,
        int count,
        Func<string, DbConnection> createConnection,
        CancellationToken cancellationToken)
    {
        var wanted = Math.Clamp(count, 0, MaxCount);
        if (wanted == 0)
        {
            return 0;
        }

        var connections = new List<DbConnection>(wanted);
        try
        {
            for (var index = 0; index < wanted; index++)
            {
                connections.Add(createConnection(connectionString));
            }

            // All at once: the pool can only hand out distinct physical connections to opens that overlap.
            await Task.WhenAll(connections.Select(connection => connection.OpenAsync(cancellationToken)));
            return wanted;
        }
        finally
        {
            // Back to the pool (a closed pooled connection stays alive there).
            foreach (var connection in connections)
            {
                await connection.DisposeAsync();
            }
        }
    }
}
