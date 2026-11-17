using Juple.Application.Admin;
using Juple.Application.Billing;
using Juple.Domain.Admin;
using Juple.Domain.Billing;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Admin;

public sealed class MembershipGrantIntegrationTests
{
    private readonly string _connection = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
        ?? throw new InvalidOperationException("A local SQL Server test database is required.");

    private JupleDbContext Open() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connection).Options);

    [Fact]
    public async Task Exact_lookup_preview_grants_retries_and_revoke_preserve_trial_and_store_ownership()
    {
        var now = new DateTimeOffset(2026, 11, 17, 0, 0, 0, TimeSpan.Zero);
        await using var db = Open();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var target = new User("ko-KR", "Asia/Seoul", null, now.AddDays(-60), now);
        var owner = new User("ko-KR", "Asia/Seoul", null, now, now);
        var nonAdmin = new User("ko-KR", "Asia/Seoul", null, now, now);
        db.Users.AddRange(target, owner, nonAdmin);
        await db.SaveChangesAsync();
        db.AdminUsers.Add(new AdminUser(owner.Id, AdminRole.Owner, null, now));
        await db.SaveChangesAsync();
        var store = new MembershipGrantStore(db);
        var options = new BillingOptions { PurchasePreviewUserIds = [38] };

        Assert.Equal(target.Id, (await store.FindUserAsync(null, target.PublicCode, default))!.UserId);
        Assert.Equal(target.PublicCode, (await store.FindUserAsync(target.Id, null, default))!.JupleId);
        Assert.Contains(new MembershipSearchResult(target.PublicCode),
            await store.SearchUsersAsync(target.PublicCode.Substring(2, 4), 100, default));
        Assert.Null(await store.FindUserAsync(long.MaxValue, null, default));
        Assert.False(await MembershipOffer.IsOfferedAsync(options, store, target.Id, default));

        var preview = new MembershipGrant(Guid.NewGuid(), target.Id, MembershipGrantKind.Preview, owner.Id, now, now, null, "Preview access");
        Assert.Equal(MembershipWriteResult.Forbidden, await store.GrantAsync(
            new(Guid.NewGuid(), target.Id, MembershipGrantKind.Preview, nonAdmin.Id, now, now, null, "Unapproved"), default));
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(preview, default));
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(preview, default));
        Assert.True(await MembershipOffer.IsOfferedAsync(options, store, target.Id, default));
        Assert.Null((await store.GetComplimentaryAsync(target.Id, now, default)).ActiveUntilUtc);

        var end = now.AddDays(10);
        var free = new MembershipGrant(Guid.NewGuid(), target.Id, MembershipGrantKind.Complimentary, owner.Id, now, now, end, "Limited access");
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(free, default));
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(free, default));
        Assert.Equal(MembershipWriteResult.Conflict, await store.GrantAsync(
            new(Guid.NewGuid(), target.Id, MembershipGrantKind.Complimentary, owner.Id, now, now.AddDays(1), end, "Overlap"), default));
        Assert.False(await MembershipOffer.CanBuyAsync(options, store, target.Id, now, default));
        Assert.False(options.ProgramEnabled);
        Assert.Equal(end, (await store.GetComplimentaryAsync(target.Id, now, default)).ActiveUntilUtc);
        Assert.Equal(new ComplimentaryAccess(null, end), await store.GetComplimentaryAsync(target.Id, end, default));
        var entitlementBeforeLaunch = await new EntitlementService(options, new EntitlementStore(db),
            new TrialIdentityHasher(options), new FixedClock(now), store).GetForUserAsync(target.Id);
        Assert.False(entitlementBeforeLaunch.ProgramEnabled);
        Assert.True(entitlementBeforeLaunch.CanWrite);
        Assert.Null(entitlementBeforeLaunch.TrialStartedAtUtc);
        Assert.Equal(end, entitlementBeforeLaunch.ComplimentaryAccessEndsAtUtc);

        Assert.False(await db.StorePurchases.AnyAsync(row => row.UserId == target.Id));
        var paidEnd = now.AddDays(30);
        var paidPurchase = new StorePurchase(target.Id, StoreSource.GooglePlay, "juple_monthly",
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(32), [1], now);
        paidPurchase.ApplyVerified(new(StorePurchaseState.Active, EntitlementReason.None, paidEnd, true, false, now.AddDays(1)), "monthly", now, now);
        db.StorePurchases.Add(paidPurchase);
        await db.SaveChangesAsync();
        var accessStore = new EntitlementStore(db);
        var trial = new TrialWindow(now.AddDays(-60), now.AddDays(-30));
        var both = EntitlementCalculator.Effective(trial, await accessStore.GetPurchaseAccessAsync(target.Id), now,
            await store.GetComplimentaryAsync(target.Id, now, default));
        Assert.Equal(paidEnd, both.CurrentPeriodEndsAtUtc);
        var revoked = now.AddDays(1);
        Assert.Equal(MembershipWriteResult.Saved, await store.RevokeAsync(owner.Id, target.Id, free.Id, revoked, "Support case closed", default));
        Assert.Equal(MembershipWriteResult.Saved, await store.RevokeAsync(owner.Id, target.Id, free.Id, revoked.AddHours(1), "Retry", default));
        var access = await store.GetComplimentaryAsync(target.Id, revoked, default);
        Assert.Equal(new ComplimentaryAccess(null, revoked), access);
        Assert.Equal(paidEnd, EntitlementCalculator.Effective(trial, await accessStore.GetPurchaseAccessAsync(target.Id), revoked, access).CurrentPeriodEndsAtUtc);
        Assert.Equal(revoked, EntitlementCalculator.Effective(trial, [], revoked, access).AccessFrozenAtUtc);

        Assert.Equal(MembershipWriteResult.Saved, await store.RevokeAsync(owner.Id, target.Id, preview.Id, revoked, "Preview ended", default));
        Assert.False(await MembershipOffer.IsOfferedAsync(options, store, target.Id, default));
        Assert.True(await MembershipOffer.IsOfferedAsync(options, store, 38, default));
        Assert.Null(target.TrialEndsAtUtc);
        var persisted = Assert.Single(await accessStore.GetOwnedPurchasesAsync(target.Id));
        Assert.Equal(StorePurchaseState.Active, persisted.State);
        Assert.Equal(paidEnd, persisted.AccessEndsAtUtc);
        Assert.Equal(4, await db.AdminAuditLogs.CountAsync(row => row.AdminUserId == owner.Id && row.TargetType == "MembershipUser"));
    }

    [Fact]
    public async Task Owner_can_manage_own_preview_but_cannot_grant_or_revoke_own_complimentary_access()
    {
        var now = DateTimeOffset.UtcNow;
        await using var db = Open();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var owner = new User("ko-KR", "Asia/Seoul", null, now, now);
        var otherOwner = new User("ko-KR", "Asia/Seoul", null, now, now);
        db.Users.AddRange(owner, otherOwner);
        await db.SaveChangesAsync();
        db.AdminUsers.AddRange(new AdminUser(owner.Id, AdminRole.Owner, null, now), new AdminUser(otherOwner.Id, AdminRole.Owner, null, now));
        await db.SaveChangesAsync();
        var store = new MembershipGrantStore(db);

        var preview = new MembershipGrant(Guid.NewGuid(), owner.Id, MembershipGrantKind.Preview, owner.Id, now, now, null, "Preview");
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(preview, default));
        Assert.True(await store.HasPreviewAsync(owner.Id, default));
        Assert.Null((await store.GetComplimentaryAsync(owner.Id, now, default)).ActiveUntilUtc);
        Assert.Equal(MembershipWriteResult.Missing, await store.RevokeAsync(owner.Id, otherOwner.Id, preview.Id, now, "Wrong target", default));
        Assert.Equal(MembershipWriteResult.Saved, await store.RevokeAsync(owner.Id, owner.Id, preview.Id, now, "Preview ended", default));
        Assert.False(await store.HasPreviewAsync(owner.Id, default));

        Assert.Equal(MembershipWriteResult.Forbidden, await store.GrantAsync(
            new(Guid.NewGuid(), owner.Id, MembershipGrantKind.Complimentary, owner.Id, now, now, now.AddDays(1), "Self grant"), default));
        var free = new MembershipGrant(Guid.NewGuid(), owner.Id, MembershipGrantKind.Complimentary, otherOwner.Id, now, now, now.AddDays(1), "Support");
        Assert.Equal(MembershipWriteResult.Saved, await store.GrantAsync(free, default));
        Assert.Equal(MembershipWriteResult.Forbidden, await store.RevokeAsync(owner.Id, owner.Id, free.Id, now, "Self revoke", default));
        Assert.Equal(MembershipWriteResult.Missing, await store.RevokeAsync(owner.Id, otherOwner.Id, free.Id, now, "Wrong target", default));
        Assert.Equal(now.AddDays(1), (await store.GetComplimentaryAsync(owner.Id, now, default)).ActiveUntilUtc);
        Assert.Equal(MembershipWriteResult.Saved, await store.RevokeAsync(otherOwner.Id, owner.Id, free.Id, now, "Support ended", default));
    }

    [Fact]
    public async Task Concurrent_grant_retries_write_one_grant_and_one_audit_entry()
    {
        var now = DateTimeOffset.UtcNow;
        await using var db = Open();
        var target = new User("ko-KR", "Asia/Seoul", null, now, now);
        var owner = new User("ko-KR", "Asia/Seoul", null, now, now);
        db.Users.AddRange(target, owner);
        await db.SaveChangesAsync();

        try
        {
            db.AdminUsers.Add(new AdminUser(owner.Id, AdminRole.Owner, null, now));
            await db.SaveChangesAsync();
            var id = Guid.NewGuid();
            async Task<MembershipWriteResult> Grant()
            {
                await using var separate = Open();
                return await new MembershipGrantStore(separate).GrantAsync(
                    new(id, target.Id, MembershipGrantKind.Complimentary, owner.Id, now, now, now.AddDays(1), "Concurrent retry"), default);
            }

            var results = await Task.WhenAll(Grant(), Grant());
            Assert.All(results, result => Assert.Equal(MembershipWriteResult.Saved, result));
            Assert.Single(await new MembershipGrantStore(db).HistoryAsync(target.Id, default));
            Assert.Equal(1, await db.AdminAuditLogs.CountAsync(row => row.AdminUserId == owner.Id && row.TargetType == "MembershipUser"));
        }
        finally
        {
            await db.AdminAuditLogs.Where(row => row.AdminUserId == owner.Id && row.TargetType == "MembershipUser").ExecuteDeleteAsync();
            await db.Users.Where(user => user.Id == owner.Id || user.Id == target.Id).ExecuteDeleteAsync();
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
