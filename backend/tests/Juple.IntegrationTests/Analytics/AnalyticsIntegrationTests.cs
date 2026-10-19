using Juple.Application.Admin;
using Juple.Domain.Analytics;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Analytics;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Analytics;

/// <summary>
/// analytics.UserDailyActivities and the Admin analytics aggregates against the real SQL Server schema. The aggregates are checked in
/// a synthetic UTC window in 2001 that no other data touches (activity dates, signups, saves and Collections are all placed there),
/// so the counts are exact; unwindowed totals are compared as deltas.
/// </summary>
public sealed class AnalyticsIntegrationTests : IAsyncLifetime
{
    private static readonly DateOnly Today = new(2001, 3, 31);

    private string _connectionString = null!;
    private readonly List<long> _userIds = [];

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run the analytics integration tests against a local SQL Server.");
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(db).DeleteAllDataAsync(userId, $"test/analytics/{userId}/", DateTimeOffset.UtcNow);
        }

        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/analytics/%'");
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private static DateTimeOffset At(DateOnly day, int hour = 12) => new(day.ToDateTime(new TimeOnly(hour, 0)), TimeSpan.Zero);

    private async Task<User> NewUserAsync(DateTimeOffset createdAtUtc)
    {
        await using var db = NewContext();
        var user = new User("en-US", "UTC", null, createdAtUtc, createdAtUtc);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user;
    }

    private async Task RecordAsync(long userId, DateOnly day, ClientPlatform platform, string? build = null, int hour = 12)
    {
        await using var db = NewContext();
        await new UserActivityStore(db).RecordAsync(userId, day, platform, build, At(day, hour));
    }

    private async Task<List<UserDailyActivity>> RowsAsync(long userId)
    {
        await using var db = NewContext();
        return await db.UserDailyActivities.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.ActivityDateUtc).ThenBy(row => row.Platform).ToListAsync();
    }

    [Fact]
    public async Task FirstWrite_SameDayUpsert_NextDayNewRow()
    {
        var person = await NewUserAsync(At(Today.AddDays(-40)));

        await RecordAsync(person.Id, Today, ClientPlatform.Android, build: null, hour: 8);
        await RecordAsync(person.Id, Today, ClientPlatform.Android, build: "31", hour: 15);
        await RecordAsync(person.Id, Today, ClientPlatform.Android, build: null, hour: 10); // an older, late write never moves LastSeen back
        var sameDay = Assert.Single(await RowsAsync(person.Id));
        Assert.Equal((At(Today, 8), At(Today, 15), "31"), (sameDay.FirstSeenAtUtc, sameDay.LastSeenAtUtc, sameDay.AppBuild));

        await RecordAsync(person.Id, Today.AddDays(1), ClientPlatform.Android);
        await RecordAsync(person.Id, Today, ClientPlatform.Web);
        Assert.Equal(3, (await RowsAsync(person.Id)).Count);
    }

    [Fact]
    public async Task ConcurrentFirstWrites_ConvergeOnOneRow()
    {
        var person = await NewUserAsync(At(Today.AddDays(-40)));

        await Task.WhenAll(Enumerable.Range(0, 25).Select(i => RecordAsync(person.Id, Today, ClientPlatform.Ios, build: "120", hour: i % 24)));

        var row = Assert.Single(await RowsAsync(person.Id));
        Assert.Equal(At(Today, 23), row.LastSeenAtUtc);
    }

    [Fact]
    public async Task AccountDeletion_RemovesThePersonsActivity()
    {
        var person = await NewUserAsync(At(Today.AddDays(-40)));
        var other = await NewUserAsync(At(Today.AddDays(-40)));
        await RecordAsync(person.Id, Today, ClientPlatform.Android);
        await RecordAsync(person.Id, Today.AddDays(-1), ClientPlatform.Web);
        await RecordAsync(other.Id, Today, ClientPlatform.Android);

        await using (var db = NewContext())
        {
            await new AccountDeletionStore(db).DeleteAllDataAsync(person.Id, $"test/analytics/{person.Id}/", DateTimeOffset.UtcNow);
        }

        _userIds.Remove(person.Id);
        Assert.Empty(await RowsAsync(person.Id));
        Assert.Single(await RowsAsync(other.Id));
    }

    [Fact]
    public async Task ARecordForADeletedAccount_IsRefusedByTheDatabase()
    {
        await using var db = NewContext();
        await Assert.ThrowsAnyAsync<Exception>(() => new UserActivityStore(db).RecordAsync(long.MaxValue - 7, Today, ClientPlatform.Web, null, At(Today)));
    }

    [Fact]
    public async Task Overview_DistinctActiveUsers_Platforms_AndDailySeries()
    {
        var before = await OverviewAsync("30d", 30);

        // Signups: two in the window (one today), one long before it.
        var a = await NewUserAsync(At(Today, 9));
        var b = await NewUserAsync(At(Today.AddDays(-3)));
        var c = await NewUserAsync(At(Today.AddDays(-200)));

        // a: Android + Web today (one person on two platforms), Android 3 days ago.  b: iOS 10 days ago.  c: Web 40 days ago (outside 30d).
        await RecordAsync(a.Id, Today, ClientPlatform.Android, "31");
        await RecordAsync(a.Id, Today, ClientPlatform.Web);
        await RecordAsync(a.Id, Today.AddDays(-3), ClientPlatform.Android, "31");
        await RecordAsync(b.Id, Today.AddDays(-10), ClientPlatform.Ios, "7");
        await RecordAsync(c.Id, Today.AddDays(-40), ClientPlatform.Web);

        await using (var db = NewContext())
        {
            // Links: two saved today (one already in the trash), one 5 days ago, one 60 days ago.
            var trashed = new Item(a.Id, "https://example.com/analytics/1", At(Today, 10));
            trashed.SoftDelete(At(Today, 11));
            db.Items.AddRange(
                trashed,
                new Item(a.Id, "https://example.com/analytics/2", At(Today, 13)),
                new Item(b.Id, "https://example.com/analytics/3", At(Today.AddDays(-5))),
                new Item(b.Id, "https://example.com/analytics/4", At(Today.AddDays(-60))));
            // Collections: one today, one 20 days ago.
            db.Collections.AddRange(
                new Collection(a.Id, "A", "a", CollectionIcon.Folder, At(Today, 9)),
                new Collection(b.Id, "B", "b", CollectionIcon.Folder, At(Today.AddDays(-20))));
            await db.SaveChangesAsync();
        }

        var month = await OverviewAsync("30d", 30);
        var week = await OverviewAsync("7d", 7);
        var quarter = await OverviewAsync("90d", 90);

        // Distinct users, never sums: a counts once today although active on two platforms.
        Assert.Equal((1, 1, 2), (month.Users.Dau, month.Users.Wau, month.Users.Mau));
        Assert.Equal(3, quarter.Platforms.ActiveUsersInRange);
        Assert.Equal(2, month.Platforms.ActiveUsersInRange);
        Assert.Equal(1, week.Platforms.ActiveUsersInRange);
        Assert.Equal(
            [("Android", 1), ("Ios", 1), ("Web", 1), ("Unknown", 0)],
            month.Platforms.Items.Select(item => (item.Platform, item.ActiveUsers)));
        Assert.Equal([("Android", 1), ("Ios", 0), ("Web", 1), ("Unknown", 0)], week.Platforms.Items.Select(item => (item.Platform, item.ActiveUsers)));
        Assert.Equal(2, quarter.Platforms.Items.Single(item => item.Platform == "Web").ActiveUsers);
        Assert.True(month.ActivityTrackingSince <= Today.AddDays(-40));

        // Series: one entry per UTC day, oldest first, ending today.
        Assert.Equal(30, month.Series.Count);
        Assert.Equal((Today.AddDays(-29), Today), (month.Series[0].Date, month.Series[^1].Date));
        Assert.Equal(90, quarter.Series.Count);
        Assert.Equal(7, week.Series.Count);
        var today = month.Series[^1];
        Assert.Equal((1, 1, 2, 1), (today.Signups, today.ActiveUsers, today.LinksSaved, today.CollectionsCreated));
        Assert.Equal(1, month.Series.Single(day => day.Date == Today.AddDays(-3)).Signups);
        Assert.Equal(1, month.Series.Single(day => day.Date == Today.AddDays(-10)).ActiveUsers);

        // Signups / saves / Collections in the window (exact) and totals (deltas).
        Assert.Equal((1, 2, 2, 2), (month.Users.NewToday, month.Users.New7Days, month.Users.New30Days, month.Users.NewInRange));
        Assert.Equal(3, month.Users.Total - before.Users.Total);
        Assert.Equal((2, 3, 3, 3, 2), (month.Links.SavedToday, month.Links.Saved7Days, month.Links.Saved30Days, month.Links.SavedInRange, month.Links.UniqueSaversInRange));
        Assert.Equal(4, quarter.Links.SavedInRange);
        Assert.Equal(3, month.Links.TotalLive - before.Links.TotalLive); // the trashed one is not live
        Assert.Equal((1, 2, 2), (month.Collections.Created7Days, month.Collections.Created30Days, month.Collections.CreatedInRange));
        Assert.Equal(2, month.Collections.TotalLive - before.Collections.TotalLive);
        Assert.False(month.Countries.Available);
    }

    [Fact]
    public async Task UserLinkStats_CountsOnlyThatPerson_AtTheDayBoundaries_TrashIncluded_PurgedGone()
    {
        var a = await NewUserAsync(At(Today.AddDays(-200)));
        var b = await NewUserAsync(At(Today.AddDays(-200)));
        var empty = await NewUserAsync(At(Today.AddDays(-2)));

        Item Saved(long userId, int n, DateTimeOffset at) => new(userId, $"https://example.com/userstats/{userId}/{n}", at);
        var trashed = Saved(a.Id, 9, At(Today, 5));
        trashed.SoftDelete(At(Today, 6));
        var purged = Saved(a.Id, 11, At(Today, 7));
        await using (var db = NewContext())
        {
            db.Items.AddRange(
                Saved(a.Id, 1, At(Today, 0)),                                          // first instant of today (inclusive)
                Saved(a.Id, 2, At(Today, 23).AddMinutes(59)),                          // last minute of today
                Saved(a.Id, 3, At(Today.AddDays(-6))),                                 // oldest day of the 7d window
                Saved(a.Id, 4, At(Today.AddDays(-7))),                                 // just outside 7d
                Saved(a.Id, 5, At(Today.AddDays(-29))),                                // oldest day of 30d
                Saved(a.Id, 6, At(Today.AddDays(-30))),                                // just outside 30d
                Saved(a.Id, 7, At(Today.AddDays(-89), 0)),                             // oldest day of 90d
                Saved(a.Id, 8, At(Today.AddDays(-90), 23).AddMinutes(59)),             // just outside 90d
                Saved(a.Id, 10, At(Today.AddDays(1), 0)),                              // tomorrow: not counted
                trashed,
                purged,
                Saved(b.Id, 1, At(Today)),                                             // another person's: must not leak in
                Saved(b.Id, 2, At(Today.AddDays(-3))));
            await db.SaveChangesAsync();
            db.Items.Remove(purged); // permanently deleted - nothing is left to count
            await db.SaveChangesAsync();
        }

        var now = At(Today, 23);
        await using var read = NewContext();
        var store = new AdminAnalyticsStore(read);

        var month = (await store.GetUserLinkStatsAsync(a.Id, "30d", 30, Today, now))!;
        Assert.Equal((a.Id, a.PublicCode), (month.UserId, month.JupleId));
        Assert.Equal(9, month.LiveLinks); // 11 saved - trashed - purged; out-of-window links still live
        // Trash counts as saved (same as the overview); the purged one and tomorrow's do not.
        Assert.Equal((3, 4, 6, 8), (month.SavedToday, month.Saved7Days, month.Saved30Days, month.Saved90Days));
        Assert.Equal(6, month.SavedInRange);
        Assert.Equal(30, month.Series.Count);
        Assert.Equal((Today.AddDays(-29), Today), (month.Series[0].Date, month.Series[^1].Date));
        Assert.Equal(3, month.Series[^1].LinksSaved);
        Assert.Equal(0, month.Series.Single(day => day.Date == Today.AddDays(-28)).LinksSaved); // a real 0, present in the series
        Assert.Equal(month.SavedInRange, month.Series.Sum(day => day.LinksSaved));

        var week = (await store.GetUserLinkStatsAsync(a.Id, "7d", 7, Today, now))!;
        Assert.Equal((7, 4), (week.Series.Count, week.SavedInRange));
        var quarter = (await store.GetUserLinkStatsAsync(a.Id, "90d", 90, Today, now))!;
        Assert.Equal((90, 8), (quarter.Series.Count, quarter.SavedInRange));
        Assert.Equal(1, quarter.Series[0].LinksSaved); // day -89

        var other = (await store.GetUserLinkStatsAsync(b.Id, "30d", 30, Today, now))!;
        Assert.Equal((2, 1, 2), (other.LiveLinks, other.SavedToday, other.Saved30Days));

        var none = (await store.GetUserLinkStatsAsync(empty.Id, "30d", 30, Today, now))!;
        Assert.Equal((0, 0, 0, 0, 0, 0), (none.LiveLinks, none.SavedToday, none.Saved7Days, none.Saved30Days, none.Saved90Days, none.SavedInRange));
        Assert.All(none.Series, day => Assert.Equal(0, day.LinksSaved));

        Assert.Null(await store.GetUserLinkStatsAsync(long.MaxValue, "30d", 30, Today, now));
    }

    private async Task<AdminAnalyticsOverview> OverviewAsync(string range, int days)
    {
        await using var db = NewContext();
        return await new AdminAnalyticsStore(db).GetOverviewAsync(range, days, Today, At(Today, 23));
    }
}
