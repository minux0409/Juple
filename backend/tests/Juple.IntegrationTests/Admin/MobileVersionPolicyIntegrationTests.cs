using Juple.Application.Admin;
using Juple.Domain.Admin;
using Juple.Domain.Users;
using Juple.Infrastructure.Admin;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Admin;

/// <summary>
/// admin.MobileVersionPolicies against the real SQL Server schema: the first save of a platform, updates checked against the
/// rowversion, two simultaneous first saves, the audit record in the same transaction, the database's own constraints and the
/// grant re-check. The two platform rows are global, so whatever the local database held before is put back afterwards.
/// </summary>
public sealed class MobileVersionPolicyIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private readonly List<long> _userIds = [];
    private List<MobileVersionPolicySetting> _before = [];

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run the integration tests against a local SQL Server.");
        await using var db = NewContext();
        _before = await db.MobileVersionPolicySettings.AsNoTracking().ToListAsync();
        await db.MobileVersionPolicySettings.ExecuteDeleteAsync();
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        await db.MobileVersionPolicySettings.ExecuteDeleteAsync();
        foreach (var row in _before)
        {
            db.MobileVersionPolicySettings.Add(new MobileVersionPolicySetting(row.Platform, row.LatestBuild, row.MinimumSupportedBuild, row.UpdatedByAdminUserId, row.UpdatedAtUtc));
        }

        await db.SaveChangesAsync();
        foreach (var userId in _userIds)
        {
            await db.AdminAuditLogs.Where(log => log.AdminUserId == userId).ExecuteDeleteAsync();
            await new AccountDeletionStore(db).DeleteAllDataAsync(userId, $"test/app-version/{userId}/", DateTimeOffset.UtcNow);
        }

        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/app-version/%'");
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private MobileVersionPolicyAdminService Service(JupleDbContext? db = null) => new(new MobileVersionPolicyStore(db ?? NewContext()), TimeProvider.System);

    private async Task<long> NewAdminAsync(bool active = true)
    {
        await using var db = NewContext();
        var now = DateTimeOffset.UtcNow;
        var user = new User("ko-KR", "Asia/Seoul", null, now, now);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        _userIds.Add(user.Id);
        if (active)
        {
            db.AdminUsers.Add(new AdminUser(user.Id, AdminRole.Owner, null, now));
            await db.SaveChangesAsync();
        }

        return user.Id;
    }

    private async Task<List<AdminAuditLog>> AuditAsync(long adminUserId)
    {
        await using var db = NewContext();
        return await db.AdminAuditLogs.AsNoTracking()
            .Where(log => log.AdminUserId == adminUserId && log.TargetType == AdminAuditTargets.MobileVersionPolicy)
            .OrderBy(log => log.Id)
            .ToListAsync();
    }

    [Fact]
    public async Task AndroidFrom33To34_ThenAConfirmedMinimumRaise_EachAudited_IosUntouched()
    {
        var admin = await NewAdminAsync();
        var configured = new MobileBuildPolicy(33, 24);

        var first = await Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(34, 24, null), configured);
        var second = await Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(34, 25, first.Stored!.Version, ConfirmMinimumIncrease: true), configured);

        Assert.True(first.Changed);
        Assert.Equal((34, 24), (first.Stored.LatestBuild, first.Stored.MinimumSupportedBuild));
        Assert.Equal((34, 25), (second.Stored!.LatestBuild, second.Stored.MinimumSupportedBuild));
        Assert.NotEqual(first.Stored.Version, second.Stored.Version);
        Assert.Equal(admin, second.Stored.UpdatedByAdminUserId);

        var rows = await new MobileVersionPolicyStore(NewContext()).ListAsync();
        Assert.Equal("android", Assert.Single(rows).Platform);
        Assert.Equal(
            ["latest 33->34; minimum 24->24; from configuration", "latest 34->34; minimum 24->25; from database"],
            (await AuditAsync(admin)).Select(log => log.Detail ?? string.Empty).ToArray());
        Assert.All(await AuditAsync(admin), log => Assert.Equal(AdminAuditActions.MobileVersionPolicyUpdated, log.Action));
    }

    [Fact]
    public async Task AStaleOrMissingVersion_IsAConflict_AndChangesNothing()
    {
        var admin = await NewAdminAsync();
        var saved = await Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(34, 24, null), new MobileBuildPolicy(33, 24));
        var current = saved.Stored!.Version;
        await Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(35, 24, current), new MobileBuildPolicy(33, 24));

        await Assert.ThrowsAsync<MobileVersionPolicyConflictException>(() =>
            Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(36, 24, current), new MobileBuildPolicy(33, 24)));
        await Assert.ThrowsAsync<MobileVersionPolicyConflictException>(() =>
            Service().SaveAsync(admin, "android", new MobileVersionPolicyChange(36, 24, null), new MobileBuildPolicy(33, 24)));

        Assert.Equal(35, (await new MobileVersionPolicyStore(NewContext()).GetAsync("android"))!.LatestBuild);
        Assert.Equal(2, (await AuditAsync(admin)).Count);
    }

    [Fact]
    public async Task TheStoreRejectsAWriteWhoseRowChangedAfterItsCheck()
    {
        var admin = await NewAdminAsync();
        var saved = (await Service().SaveAsync(admin, "ios", new MobileVersionPolicyChange(3, 3, null, ConfirmMinimumIncrease: true), new MobileBuildPolicy(0, 0))).Stored!;

        // Two stores that both passed their own read with the same token: the rowversion lets exactly one of them in.
        var a = new MobileVersionPolicyStore(NewContext()).SaveAsync(admin, "ios", saved.Version, new MobileBuildPolicy(4, 3), "a", DateTimeOffset.UtcNow);
        var b = new MobileVersionPolicyStore(NewContext()).SaveAsync(admin, "ios", saved.Version, new MobileBuildPolicy(5, 3), "b", DateTimeOffset.UtcNow);
        var outcomes = await Task.WhenAll(Settle(a), Settle(b));

        Assert.Equal(1, outcomes.Count(outcome => outcome is null));
        Assert.Equal(1, outcomes.Count(outcome => outcome is MobileVersionPolicyConflictException));
        Assert.Equal(2, (await AuditAsync(admin)).Count); // the first save and the one winner - the loser's audit row rolled back
    }

    [Fact]
    public async Task TwoSimultaneousFirstSaves_LetExactlyOneIn()
    {
        var admin = await NewAdminAsync();

        var a = new MobileVersionPolicyStore(NewContext()).SaveAsync(admin, "android", null, new MobileBuildPolicy(34, 24), "a", DateTimeOffset.UtcNow);
        var b = new MobileVersionPolicyStore(NewContext()).SaveAsync(admin, "android", null, new MobileBuildPolicy(35, 24), "b", DateTimeOffset.UtcNow);
        var outcomes = await Task.WhenAll(Settle(a), Settle(b));

        Assert.Equal(1, outcomes.Count(outcome => outcome is null));
        Assert.Equal(1, outcomes.Count(outcome => outcome is MobileVersionPolicyConflictException));
        Assert.Single(await new MobileVersionPolicyStore(NewContext()).ListAsync());
        Assert.Single(await AuditAsync(admin));
    }

    [Fact]
    public async Task WithoutAnActiveGrant_NothingIsWritten()
    {
        var notAdmin = await NewAdminAsync(active: false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            Service().SaveAsync(notAdmin, "android", new MobileVersionPolicyChange(34, 24, null), new MobileBuildPolicy(33, 24)));

        Assert.Empty(await new MobileVersionPolicyStore(NewContext()).ListAsync());
        Assert.Empty(await AuditAsync(notAdmin));
    }

    [Theory]
    [InlineData("android", 20, 30)]
    [InlineData("android", 0, 0)]
    [InlineData("windows", 34, 24)]
    public async Task TheDatabaseItselfRefusesAContradictoryOrUnknownRow(string platform, int latest, int minimum)
    {
        await using var db = NewContext();
        db.MobileVersionPolicySettings.Add(new MobileVersionPolicySetting(platform, latest, minimum, null, DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    private static async Task<Exception?> Settle(Task task)
    {
        try
        {
            await task;
            return null;
        }
        catch (Exception exception)
        {
            return exception;
        }
    }
}
