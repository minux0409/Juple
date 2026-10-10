using Juple.Domain.Billing;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Retention;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Retention;

/// <summary>
/// Runs the real purge statements against SQL Server. Every seeded "old" row is dated in 2001 and every cutoff is in 2002, so the
/// cutoffs can only ever match rows this test created - never data that happens to be in a shared local database.
/// </summary>
public sealed class RetentionStoreIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Old = new(2001, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Cutoff = new(2002, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 0, 0, 0, TimeSpan.Zero);

    private JupleDbContext _db = null!;
    private RetentionStore _store = null!;
    private long _userId;
    private readonly List<byte[]> _purchaseHashes = [];
    private readonly List<byte[]> _ledgerHashes = [];
    private readonly List<string> _eventIds = [];

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run retention integration tests.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _store = new RetentionStore(_db);

        var user = new User("en-US", "UTC", null, Now, Now);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userId = user.Id;
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        // Raw SQL, independent of the class under test, in FK-safe order (the User row does not cascade).
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.CollectionMergeOperations WHERE UserId = {_userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM notifications.Notifications WHERE UserId = {_userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {_userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.Collections WHERE UserId = {_userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {_userId}");
        foreach (var hash in _purchaseHashes)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.StorePurchases WHERE ExternalKeyHash = {hash}");
        }

        foreach (var hash in _ledgerHashes)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.TrialLedger WHERE IdentityHash = {hash}");
        }

        foreach (var id in _eventIds)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.StoreEvents WHERE ExternalEventId = {id}");
        }

        await _db.DisposeAsync();
    }

    private static byte[] NewHash() => Guid.NewGuid().ToByteArray().Concat(Guid.NewGuid().ToByteArray()).ToArray();

    private StorePurchase AddPurchase(StorePurchaseState state, DateTimeOffset? accessEnds, DateTimeOffset verifiedAt)
    {
        var hash = NewHash();
        _purchaseHashes.Add(hash);
        var purchase = new StorePurchase(null, StoreSource.GooglePlay, "p", hash, [1, 2, 3], Old);
        purchase.ApplyVerified(
            new NormalizedPurchase(state, EntitlementReason.None, accessEnds, false, false, Old), "b", Old, verifiedAt);
        _db.StorePurchases.Add(purchase);
        return purchase;
    }

    [Fact]
    public async Task TrialLedger_DeletesOnlyEndedTrials_AndIsIdempotent()
    {
        var oldHash = NewHash();
        var runningHash = NewHash();
        _ledgerHashes.AddRange([oldHash, runningHash]);
        _db.TrialLedger.Add(new TrialLedgerEntry(oldHash, Old, Old.AddDays(30), Old));
        _db.TrialLedger.Add(new TrialLedgerEntry(runningHash, Now, Now.AddDays(30), Now));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(1, await _store.DeleteTrialLedgerEntriesEndedBeforeAsync(Cutoff, 500));
        Assert.Equal(0, await _store.DeleteTrialLedgerEntriesEndedBeforeAsync(Cutoff, 500));
        Assert.False(await _db.TrialLedger.AnyAsync(e => e.IdentityHash == oldHash));
        Assert.True(await _db.TrialLedger.AnyAsync(e => e.IdentityHash == runningHash));
    }

    [Fact]
    public async Task PurchaseTokens_AreClearedOnlyForEndedPurchases_AndTheRowAndHashStay()
    {
        var expired = AddPurchase(StorePurchaseState.Expired, Old, Old);
        var revoked = AddPurchase(StorePurchaseState.Revoked, Old, Old);
        var active = AddPurchase(StorePurchaseState.Active, Old, Old);
        var onHold = AddPurchase(StorePurchaseState.OnHold, Old, Old);
        var recentExpired = AddPurchase(StorePurchaseState.Expired, Now.AddDays(-10), Now);
        await _db.SaveChangesAsync();
        var ids = new[] { expired.Id, revoked.Id, active.Id, onHold.Id, recentExpired.Id };
        _db.ChangeTracker.Clear();

        Assert.Equal(2, await _store.ClearSealedPurchaseTokensAsync(Cutoff, Now, 500));
        Assert.Equal(0, await _store.ClearSealedPurchaseTokensAsync(Cutoff, Now, 500));

        var rows = await _db.StorePurchases.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        Assert.Null(rows[expired.Id].VerificationHandleEncrypted);
        Assert.NotNull(rows[expired.Id].VerificationHandlePurgedAtUtc);
        Assert.Null(rows[revoked.Id].VerificationHandleEncrypted);
        Assert.NotEmpty(rows[expired.Id].ExternalKeyHash);
        Assert.Equal(StorePurchaseState.Expired, rows[expired.Id].State);
        Assert.NotNull(rows[active.Id].VerificationHandleEncrypted);
        Assert.NotNull(rows[onHold.Id].VerificationHandleEncrypted);
        Assert.NotNull(rows[recentExpired.Id].VerificationHandleEncrypted);
    }

    [Fact]
    public async Task PurchaseRecords_AreDeletedOnlyWhenEndedLongAgo()
    {
        var oldExpired = AddPurchase(StorePurchaseState.Expired, Old, Old);
        var oldActive = AddPurchase(StorePurchaseState.Active, Old, Old);
        var recentExpired = AddPurchase(StorePurchaseState.Expired, Now.AddDays(-10), Now);
        await _db.SaveChangesAsync();
        var ids = new[] { oldExpired.Id, oldActive.Id, recentExpired.Id };
        _db.ChangeTracker.Clear();

        Assert.Equal(1, await _store.DeleteEndedPurchaseRecordsAsync(Cutoff, 500));
        var left = await _db.StorePurchases.AsNoTracking().Where(p => ids.Contains(p.Id)).Select(p => p.Id).ToListAsync();
        Assert.DoesNotContain(oldExpired.Id, left);
        Assert.Contains(oldActive.Id, left);
        Assert.Contains(recentExpired.Id, left);
    }

    [Fact]
    public async Task StoreEvents_DeletesOnlyProcessedOldOnes()
    {
        var oldProcessed = new StoreEvent(StoreSource.GooglePlay, $"ret-{Guid.NewGuid():N}", "t", null, null, Old);
        oldProcessed.Complete(StoreEventResult.Processed, Old);
        var oldPending = new StoreEvent(StoreSource.GooglePlay, $"ret-{Guid.NewGuid():N}", "t", null, null, Old);
        var recentProcessed = new StoreEvent(StoreSource.GooglePlay, $"ret-{Guid.NewGuid():N}", "t", null, null, Now);
        recentProcessed.Complete(StoreEventResult.Processed, Now);
        _eventIds.AddRange([oldProcessed.ExternalEventId, oldPending.ExternalEventId, recentProcessed.ExternalEventId]);
        _db.StoreEvents.AddRange(oldProcessed, oldPending, recentProcessed);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(1, await _store.DeleteProcessedStoreEventsAsync(Cutoff, 500));
        Assert.False(await _db.StoreEvents.AnyAsync(e => e.ExternalEventId == oldProcessed.ExternalEventId));
        Assert.True(await _db.StoreEvents.AnyAsync(e => e.ExternalEventId == oldPending.ExternalEventId));
        Assert.True(await _db.StoreEvents.AnyAsync(e => e.ExternalEventId == recentProcessed.ExternalEventId));
    }

    [Fact]
    public async Task SoftDeletedCollections_AreDeletedWithTheirContent_ButLiveAndRestoredOnesStay()
    {
        var gone = new Collection(_userId, "gone", "GONE", CollectionIcon.Folder, Old);
        gone.SoftDelete(Old);
        var live = new Collection(_userId, "live", "LIVE", CollectionIcon.Folder, Old);
        var restored = new Collection(_userId, "restored", "RESTORED", CollectionIcon.Folder, Old);
        restored.SoftDelete(Old);
        restored.Restore();
        var recent = new Collection(_userId, "recent", "RECENT", CollectionIcon.Folder, Old);
        recent.SoftDelete(Now);
        _db.Collections.AddRange(gone, live, restored, recent);
        await _db.SaveChangesAsync();
        var item = new Item(_userId, "https://example.test/retention", Old);
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        _db.CollectionItems.Add(CollectionItem.CreateNew(gone.Id, item.Id, _userId, Old, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(1, await _store.DeleteSoftDeletedCollectionsAsync(Cutoff, 500));
        Assert.Equal(0, await _store.DeleteSoftDeletedCollectionsAsync(Cutoff, 500));

        Assert.False(await _db.Collections.AnyAsync(c => c.Id == gone.Id));
        Assert.False(await _db.CollectionItems.AnyAsync(ci => ci.CollectionId == gone.Id));
        Assert.True(await _db.Collections.AnyAsync(c => c.Id == live.Id));
        Assert.True(await _db.Collections.AnyAsync(c => c.Id == restored.Id));
        Assert.True(await _db.Collections.AnyAsync(c => c.Id == recent.Id));
        // The link itself is the user's own data and is never removed by deleting a Collection.
        Assert.True(await _db.Items.AnyAsync(i => i.Id == item.Id));
    }

    [Fact]
    public async Task Notifications_AndStalePushRegistrations_AreDeletedOnlyWhenOld()
    {
        _db.Notifications.Add(new Notification(_userId, NotificationType.RepeatPurchaseDue, null, null, "old", null, Old));
        _db.Notifications.Add(new Notification(_userId, NotificationType.RepeatPurchaseDue, null, null, "new", null, Now));
        _db.PushDeviceRegistrations.Add(new PushDeviceRegistration(_userId, PushPlatform.Android, $"i-{Guid.NewGuid():N}", "tok-old", "en", Old, Old));
        _db.PushDeviceRegistrations.Add(new PushDeviceRegistration(_userId, PushPlatform.Android, $"i-{Guid.NewGuid():N}", "tok-new", "en", Now, Now));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(1, await _store.DeleteNotificationsAsync(Cutoff, 500));
        Assert.Equal(1, await _store.DeleteStalePushRegistrationsAsync(Cutoff, 500));
        Assert.Equal(0, await _store.DeleteNotificationsAsync(Cutoff, 500));

        Assert.False(await _db.Notifications.AnyAsync(n => n.UserId == _userId && n.ProductNameSnapshot == "old"));
        Assert.True(await _db.Notifications.AnyAsync(n => n.UserId == _userId && n.ProductNameSnapshot == "new"));
        Assert.False(await _db.PushDeviceRegistrations.AnyAsync(p => p.UserId == _userId && p.PushToken == "tok-old"));
        Assert.True(await _db.PushDeviceRegistrations.AnyAsync(p => p.UserId == _userId && p.PushToken == "tok-new"));
    }

    [Fact]
    public async Task TrashItems_AreDeletedOnlyWhenOldAndReturnedForBlobCleanup_NeverLiveOnes()
    {
        var oldTrash = new Item(_userId, "https://example.test/old-trash", Old);
        oldTrash.SoftDelete(Old);
        var live = new Item(_userId, "https://example.test/live", Old);
        var recentTrash = new Item(_userId, "https://example.test/recent-trash", Old);
        recentTrash.SoftDelete(Now);
        _db.Items.AddRange(oldTrash, live, recentTrash);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var purged = await _store.DeleteExpiredTrashItemsAsync(Cutoff, 500);
        Assert.Single(purged);
        Assert.Equal(oldTrash.Id, purged[0].ItemId);
        Assert.Equal(_userId, purged[0].UserId);
        Assert.Empty(await _store.DeleteExpiredTrashItemsAsync(Cutoff, 500));

        Assert.False(await _db.Items.AnyAsync(i => i.Id == oldTrash.Id));
        Assert.True(await _db.Items.AnyAsync(i => i.Id == live.Id));
        Assert.True(await _db.Items.AnyAsync(i => i.Id == recentTrash.Id));
    }

    [Fact]
    public async Task BatchSize_BoundsEachCall()
    {
        for (var i = 0; i < 3; i++)
        {
            _db.Notifications.Add(new Notification(_userId, NotificationType.RepeatPurchaseDue, null, null, "b", null, Old));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(2, await _store.DeleteNotificationsAsync(Cutoff, 2));
        Assert.Equal(1, await _store.DeleteNotificationsAsync(Cutoff, 2));
    }

    [Fact]
    public async Task APurgedPurchase_PresentedAgain_ReusesTheRow_KeepsTheHash_AndGetsANewSealedToken()
    {
        var purchase = AddPurchase(StorePurchaseState.Expired, Old, Old);
        await _db.SaveChangesAsync();
        var hash = purchase.ExternalKeyHash;
        _db.ChangeTracker.Clear();
        await _store.ClearSealedPurchaseTokensAsync(Cutoff, Now, 500);
        _db.ChangeTracker.Clear();
        Assert.Null((await _db.StorePurchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id)).VerificationHandleEncrypted);

        var billing = new Juple.Infrastructure.Billing.GoogleBillingStore(_db);
        var active = new NormalizedPurchase(StorePurchaseState.Active, EntitlementReason.None, Now.AddDays(30), true, false, Now.AddHours(6));
        var record = await billing.UpsertPurchaseAsync(
            new Juple.Application.Billing.GooglePlay.UpsertPurchaseCommand(hash, [9, 9, 9], "p", "b", Now, active, null, false, Now));
        _db.ChangeTracker.Clear();

        Assert.Equal(purchase.Id, record.Id);
        var row = await _db.StorePurchases.AsNoTracking().SingleAsync(p => p.ExternalKeyHash == hash);
        Assert.Equal(purchase.Id, row.Id);
        Assert.Equal(new byte[] { 9, 9, 9 }, row.VerificationHandleEncrypted);
        Assert.Null(row.VerificationHandlePurgedAtUtc);
        Assert.Equal(StorePurchaseState.Active, row.State);
        // A live purchase with a handle is outside every purge condition.
        Assert.Equal(0, await _store.ClearSealedPurchaseTokensAsync(Cutoff, Now, 500));
        Assert.Equal(0, await _store.DeleteEndedPurchaseRecordsAsync(Cutoff, 500));
    }
}
