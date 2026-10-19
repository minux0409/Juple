using System.Security.Cryptography;
using Juple.Domain.Analytics;
using Juple.Domain.Billing;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Analytics;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Analytics;

/// <summary>
/// 회원 상태 and 링크 보유량 against the real SQL Server schema. Both count over every account in the (shared) database, so each
/// test compares a before/after delta caused only by its own accounts.
/// </summary>
public sealed class AnalyticsMembershipIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset ProgramStart = new(2001, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private string _connectionString = null!;
    private readonly List<long> _userIds = [];
    private readonly List<byte[]> _purchaseHashes = [];
    private readonly DateTimeOffset _now = DateTimeOffset.UtcNow;

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
            await new AccountDeletionStore(db).DeleteAllDataAsync(userId, $"test/analytics-members/{userId}/", DateTimeOffset.UtcNow);
        }

        foreach (var hash in _purchaseHashes)
        {
            await db.StorePurchases.Where(purchase => purchase.ExternalKeyHash == hash).ExecuteDeleteAsync();
        }

        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/analytics-members/%'");
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<User> NewUserAsync(DateTimeOffset createdAtUtc, TrialWindow? settledTrial = null)
    {
        await using var db = NewContext();
        var user = new User("en-US", "UTC", null, createdAtUtc, createdAtUtc);
        if (settledTrial is { } window)
        {
            user.SetTrial(window);
        }

        db.Users.Add(user);
        await db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user;
    }

    private async Task PurchaseAsync(long userId, StorePurchaseState state, DateTimeOffset accessEnds)
    {
        await using var db = NewContext();
        var hash = RandomNumberGenerator.GetBytes(32);
        _purchaseHashes.Add(hash);
        var purchase = new StorePurchase(userId, StoreSource.GooglePlay, "juple.monthly", hash, [1, 2, 3], _now.AddDays(-40));
        purchase.ApplyVerified(new NormalizedPurchase(state, EntitlementReason.None, accessEnds, state == StorePurchaseState.Active, false, _now), "monthly", _now.AddDays(-40), _now);
        db.StorePurchases.Add(purchase);
        await db.SaveChangesAsync();
    }

    private async Task<Juple.Application.Admin.AdminMembership> MembershipAsync(DateTimeOffset? programStart)
    {
        await using var db = NewContext();
        return await new AdminAnalyticsStore(db).GetMembershipAsync(_now, DateOnly.FromDateTime(_now.UtcDateTime), programStart);
    }

    [Fact]
    public async Task Membership_ExclusiveGroups_FollowTheEntitlementRules_At29_30_31Days()
    {
        var before = await MembershipAsync(ProgramStart);
        var off = await MembershipAsync(null);

        var day29 = await NewUserAsync(_now.AddDays(-29));                      // trial ends in 1 day  -> InTrial
        var day30 = await NewUserAsync(_now.AddDays(-30));                      // trial ends exactly now -> ended
        var day31 = await NewUserAsync(_now.AddDays(-31));                      // ended
        var paid = await NewUserAsync(_now.AddDays(-60));                       // live Active purchase -> Paid
        var canceled = await NewUserAsync(_now.AddDays(-60));                   // Canceled but period not over -> Paid
        var grace = await NewUserAsync(_now.AddDays(-60));                      // only a live grace period -> GracePeriod
        var lapsed = await NewUserAsync(_now.AddDays(-60));                     // Expired purchase -> TrialEndedUnpaid
        var settled = await NewUserAsync(_now.AddDays(-60), new TrialWindow(_now.AddDays(-25), _now.AddDays(5))); // ledger window -> InTrial
        var deleted = await NewUserAsync(_now.AddDays(-1));
        await PurchaseAsync(paid.Id, StorePurchaseState.Active, _now.AddDays(20));
        await PurchaseAsync(canceled.Id, StorePurchaseState.Canceled, _now.AddDays(3));
        await PurchaseAsync(grace.Id, StorePurchaseState.GracePeriod, _now.AddHours(20));
        await PurchaseAsync(lapsed.Id, StorePurchaseState.Expired, _now.AddDays(-2));
        await using (var db = NewContext())
        {
            await new AccountDeletionStore(db).DeleteAllDataAsync(deleted.Id, $"test/analytics-members/{deleted.Id}/", DateTimeOffset.UtcNow);
        }

        _userIds.Remove(deleted.Id);

        var after = await MembershipAsync(ProgramStart);
        Assert.True(after.BillingProgramEnabled);
        var b = before.Groups!;
        var a = after.Groups!;
        Assert.Equal((1, 1, 2, 3), (a.Paid - b.Paid - 1, a.GracePeriod - b.GracePeriod, a.InTrial - b.InTrial, a.TrialEndedUnpaid - b.TrialEndedUnpaid));
        Assert.Equal(8, after.TotalUsers - before.TotalUsers); // the deleted account is gone, not a group
        Assert.Equal(after.TotalUsers, a.Paid + a.GracePeriod + a.InTrial + a.TrialEndedUnpaid);
        // Account age only (exactly 30 x 24 h): the 29-day account is within, the 30- and 31-day ones are not.
        Assert.Equal(1, after.SignedUpWithin30Days - before.SignedUpWithin30Days);
        Assert.Equal(7, after.SignedUpOver30Days - before.SignedUpOver30Days);

        // Program not running: no groups at all - never zeros - but the account-age split still exists.
        var offAfter = await MembershipAsync(null);
        Assert.False(offAfter.BillingProgramEnabled);
        Assert.Null(offAfter.Groups);
        Assert.Equal(8, offAfter.TotalUsers - off.TotalUsers);
        Assert.Equal(offAfter.TotalUsers, offAfter.SignedUpWithin30Days + offAfter.SignedUpOver30Days);
    }

    [Fact]
    public async Task Membership_ATrialStartingAtTheProgramStart_ForAnOlderAccount()
    {
        // An account older than the program gets ProgramStart .. +30 d (TrialPolicy.WindowFor), not CreatedAt .. +30 d.
        var programStart = _now.AddDays(-10);
        var before = await MembershipAsync(programStart);
        await NewUserAsync(_now.AddDays(-400));
        var after = await MembershipAsync(programStart);
        Assert.Equal(1, after.Groups!.InTrial - before.Groups!.InTrial);
    }

    [Fact]
    public async Task LinkHoldings_EveryAccountIncludingZero_BucketEdges_TrashExcluded_AndTies()
    {
        await using var probe = NewContext();
        var before = await new AdminAnalyticsStore(probe).GetLinkHoldingsAsync(5);

        // 0, 1, 9, 10, 49, 50 live links; the 1-link account also has 3 trashed links (never counted).
        var counts = new[] { 0, 1, 9, 10, 49, 50 };
        var holders = new List<User>();
        foreach (var count in counts)
        {
            holders.Add(await NewUserAsync(_now.AddDays(-5)));
        }

        await using (var db = NewContext())
        {
            for (var i = 0; i < counts.Length; i++)
            {
                for (var n = 0; n < counts[i]; n++)
                {
                    db.Items.Add(new Item(holders[i].Id, $"https://example.com/holdings/{holders[i].Id}/{n}", _now.AddDays(-1)));
                }
            }

            for (var n = 0; n < 3; n++)
            {
                var trashed = new Item(holders[1].Id, $"https://example.com/holdings/{holders[1].Id}/trash/{n}", _now.AddDays(-1));
                trashed.SoftDelete(_now);
                db.Items.Add(trashed);
            }

            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        var after = await new AdminAnalyticsStore(read).GetLinkHoldingsAsync(5);
        int Delta(int min) => after.Buckets.Single(b => b.Min == min).Users - before.Buckets.Single(b => b.Min == min).Users;
        Assert.Equal([1, 2, 2, 1, 0, 0], new[] { Delta(0), Delta(1), Delta(10), Delta(50), Delta(100), Delta(500) });
        Assert.Equal([(0, (int?)0), (1, 9), (10, 49), (50, 99), (100, 499), (500, null)], after.Buckets.Select(b => (b.Min, b.Max)));
        Assert.Equal(6, after.TotalUsers - before.TotalUsers);
        Assert.Equal(5, after.UsersWithLinks - before.UsersWithLinks);
        Assert.Equal(119, after.TotalLiveLinks - before.TotalLiveLinks); // 1+9+10+49+50, no trash
        Assert.Equal(after.TotalUsers, after.Buckets.Sum(b => b.Users));
        Assert.True(after.MaxLinksPerUser >= 50);
        Assert.True(after.TopHolders.Count <= 5);
        Assert.Equal(after.MaxLinksPerUser, after.TopHolders[0].LiveLinks);
        Assert.True(after.TopHolders.Zip(after.TopHolders.Skip(1)).All(pair => pair.First.LiveLinks >= pair.Second.LiveLinks));
        Assert.All(after.TopHolders, holder => Assert.Matches("^[A-Z0-9]{8}$", holder.JupleId)); // a Juple ID, nothing else

        // A tie at the top: another account with exactly the maximum.
        var tie = await NewUserAsync(_now.AddDays(-5));
        await using (var db = NewContext())
        {
            for (var n = 0; n < after.MaxLinksPerUser; n++)
            {
                db.Items.Add(new Item(tie.Id, $"https://example.com/holdings/{tie.Id}/{n}", _now.AddDays(-1)));
            }

            await db.SaveChangesAsync();
        }

        await using var read2 = NewContext();
        var tied = await new AdminAnalyticsStore(read2).GetLinkHoldingsAsync(5);
        Assert.Equal(after.MaxLinksPerUser, tied.MaxLinksPerUser);
        Assert.Equal(after.UsersAtMax + 1, tied.UsersAtMax);
    }

    [Fact]
    public async Task PlatformSeries_PerDayPerPlatform_AndSinceTrackingStart_IncludingUnknown()
    {
        var today = new DateOnly(2001, 6, 30);
        var a = await NewUserAsync(_now.AddDays(-5));
        var b = await NewUserAsync(_now.AddDays(-5));
        await using (var db = NewContext())
        {
            var store = new UserActivityStore(db);
            await store.RecordAsync(a.Id, today, ClientPlatform.Android, "31", _now);
            await store.RecordAsync(a.Id, today, ClientPlatform.Web, null, _now);
            await store.RecordAsync(b.Id, today, ClientPlatform.Unknown, null, _now);
            await store.RecordAsync(b.Id, today.AddDays(-20), ClientPlatform.Ios, "7", _now);
        }

        await using var read = NewContext();
        var week = await new AdminAnalyticsStore(read).GetOverviewAsync("7d", 7, today, _now);
        var last = week.Series[^1];
        Assert.Equal((1, 0, 1, 1, 2), (last.ActiveAndroid, last.ActiveIos, last.ActiveWeb, last.ActiveUnknown, last.ActiveUsers));
        Assert.Equal(1, week.Platforms.Items.Single(p => p.Platform == "Unknown").ActiveUsers);
        Assert.Equal(0, week.Platforms.Items.Single(p => p.Platform == "Ios").ActiveUsers); // iOS was 20 days ago
        var since = week.PlatformsSinceTrackingStart!;
        Assert.True(since.ActiveUsersInRange >= 2);
        Assert.True(since.Items.Single(p => p.Platform == "Ios").ActiveUsers >= 1);
    }
}
