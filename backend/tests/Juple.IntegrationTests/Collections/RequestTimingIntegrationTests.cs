using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The request-timing interceptors against a real SQL Server: every open (the first one a new physical connection, the next ones
/// pooled) and every command of one request is counted for that request only, and nothing leaks afterwards.
/// </summary>
public sealed class RequestTimingIntegrationTests
{
    private static JupleDbContext NewContext()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        return new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .AddInterceptors(new RequestSqlTimingInterceptor(), new RequestConnectionTimingInterceptor())
            .Options);
    }

    [Fact]
    public async Task OpensAndCommands_AreCountedForTheRequest_PooledOpensIncluded()
    {
        using var scope = RequestSqlTimingScope.Begin(out var timing);

        for (var index = 0; index < 3; index++)
        {
            await using var db = NewContext();
            _ = await db.Users.AsNoTracking().CountAsync();
        }

        var (opens, openTotal, openMax) = timing.ConnectionSnapshot();
        var (commands, sqlTotal, sqlMax) = timing.Snapshot();
        Assert.Equal(3, opens);
        Assert.Equal(3, commands);
        Assert.True(openTotal >= openMax && openMax >= 0);
        Assert.True(sqlTotal >= sqlMax && sqlMax >= 0);
    }

    [Fact]
    public async Task ParallelRequests_KeepTheirOwnFigures()
    {
        async Task<(int Opens, int Commands)> OneRequestAsync(int queries)
        {
            using var scope = RequestSqlTimingScope.Begin(out var timing);
            for (var index = 0; index < queries; index++)
            {
                await using var db = NewContext();
                _ = await db.Users.AsNoTracking().CountAsync();
            }

            var (opens, _, _) = timing.ConnectionSnapshot();
            var (commands, _, _) = timing.Snapshot();
            return (opens, commands);
        }

        var results = await Task.WhenAll(OneRequestAsync(1), OneRequestAsync(4), OneRequestAsync(2));

        Assert.Equal([(1, 1), (4, 4), (2, 2)], results);
        Assert.Null(RequestSqlTimingScope.Current);
    }

    [Fact]
    public async Task WithNoRequestBeingTimed_NothingIsRecorded_AndNothingBreaks()
    {
        Assert.Null(RequestSqlTimingScope.Current);

        await using var db = NewContext();
        Assert.True(await db.Users.AsNoTracking().CountAsync() >= 0);
    }
}
