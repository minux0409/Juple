using Juple.Domain.Collections;
using Juple.Domain.Images;
using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Purchases;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Users;

public sealed class AccountDeletionStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;
    private long _otherItemId;
    private long _collectionId;
    private long _otherCollectionId;
    private string _publicId = null!;
    private long _repeatPurchaseId;
    private long _notificationId;
    private long _pushDeviceRegistrationId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run account deletion integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);

        var now = DateTimeOffset.UtcNow;

        var user = new User("en-US", "UTC", null, now, now);
        var otherUser = new User("en-US", "UTC", null, now, now);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/account-deletion-test", now);
        var otherItem = new Item(_otherUserId, "https://shop.example/other-user-item", now);
        _dbContext.Items.AddRange(item, otherItem);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
        _otherItemId = otherItem.Id;

        _dbContext.ItemImages.Add(
            new ItemImage(_itemId, $"items/{_userId}/{_itemId}/seed.jpg", "image/jpeg", 1_000, 0, now));

        var collection = new Collection(_userId, "Books", "BOOKS", now);
        var otherCollection = new Collection(_otherUserId, "Other Books", "OTHER BOOKS", now);
        _dbContext.Collections.AddRange(collection, otherCollection);
        await _dbContext.SaveChangesAsync();
        _collectionId = collection.Id;
        _otherCollectionId = otherCollection.Id;

        _dbContext.CollectionItems.Add(new CollectionItem(_collectionId, _itemId, now));
        _dbContext.CollectionItems.Add(new CollectionItem(_otherCollectionId, _otherItemId, now));

        _publicId = Guid.NewGuid().ToString("N");
        _dbContext.CollectionShares.Add(new CollectionShare(_collectionId, _publicId, now));
        _dbContext.CollectionShares.Add(
            new CollectionShare(_otherCollectionId, Guid.NewGuid().ToString("N"), now));

        var purchase = new Purchase(
            _userId, _itemId, DateOnly.FromDateTime(now.UtcDateTime), "Test Product",
            9900m, "USD", "Test Store", null, null, null, now);
        var otherPurchase = new Purchase(
            _otherUserId, _otherItemId, DateOnly.FromDateTime(now.UtcDateTime), "Other Product",
            5000m, "USD", "Other Store", null, null, null, now);
        _dbContext.Purchases.AddRange(purchase, otherPurchase);

        var dueDate = DateOnly.FromDateTime(now.UtcDateTime);
        var repeatPurchase = new RepeatPurchase(
            _userId, _itemId, "Test Product", 1, IntervalUnit.Month, dueDate,
            isReminderEnabled: true, reminderLeadDays: 3, isEnabled: true, now, now);
        var otherRepeatPurchase = new RepeatPurchase(
            _otherUserId, _otherItemId, "Other Product", 1, IntervalUnit.Month, dueDate,
            isReminderEnabled: true, reminderLeadDays: 3, isEnabled: true, now, now);
        _dbContext.RepeatPurchases.AddRange(repeatPurchase, otherRepeatPurchase);
        await _dbContext.SaveChangesAsync();
        _repeatPurchaseId = repeatPurchase.Id;

        purchase.AssignRepeatPurchase(repeatPurchase.Id);
        otherPurchase.AssignRepeatPurchase(otherRepeatPurchase.Id);

        var notification = new Notification(
            _userId, NotificationType.RepeatPurchaseDue, repeatPurchase.Id, _itemId, "Test Product", dueDate, now);
        var otherNotification = new Notification(
            _otherUserId, NotificationType.RepeatPurchaseDue, otherRepeatPurchase.Id, _otherItemId,
            "Other Product", dueDate, now);
        _dbContext.Notifications.AddRange(notification, otherNotification);

        var pushDeviceRegistration = new PushDeviceRegistration(
            _userId, PushPlatform.Android, "install-account-deletion", "token-1", "en", now, now);
        var otherPushDeviceRegistration = new PushDeviceRegistration(
            _otherUserId, PushPlatform.Android, "install-other-user", "token-2", "en", now, now);
        _dbContext.PushDeviceRegistrations.AddRange(pushDeviceRegistration, otherPushDeviceRegistration);
        await _dbContext.SaveChangesAsync();
        _notificationId = notification.Id;
        _pushDeviceRegistrationId = pushDeviceRegistration.Id;

        _dbContext.NotificationDeliveries.Add(new NotificationDelivery(
            notification.Id, pushDeviceRegistration.Id, NotificationDeliveryStatus.Sent, 1, now, "provider-msg-1", null));
        _dbContext.NotificationDeliveries.Add(new NotificationDelivery(
            otherNotification.Id, otherPushDeviceRegistration.Id, NotificationDeliveryStatus.Sent, 1, now, "provider-msg-2", null));

        _dbContext.RecentlyOpenedItems.Add(new RecentlyOpenedItem(_userId, _itemId, now));
        _dbContext.RecentlyOpenedItems.Add(new RecentlyOpenedItem(_otherUserId, _otherItemId, now));

        _dbContext.ItemSaveRequests.Add(new ItemSaveRequest(_userId, Guid.NewGuid(), _itemId, item.Url, now));
        _dbContext.ItemSaveRequests.Add(
            new ItemSaveRequest(_otherUserId, Guid.NewGuid(), _otherItemId, otherItem.Url, now));

        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        // Explicit raw-SQL cleanup, deliberately independent of AccountDeletionStore (the class
        // under test) - a bug there must not also silently break teardown between test runs. Order
        // matches AccountDeletionStore's own FK-safe order; harmless no-ops for whichever rows a
        // test already deleted itself.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix = {$"items/{_userId}/"} OR BlobPrefix = {$"items/{_otherUserId}/"}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM notifications.Notifications WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.RecentlyOpenedItems WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.Collections WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.ItemSaveRequests WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private static Task<long> DeleteAllDataAsync(
        AccountDeletionStore store, long userId, CancellationToken cancellationToken = default) =>
        store.DeleteAllDataAsync(userId, $"items/{userId}/", DateTimeOffset.UtcNow, cancellationToken);

    [Fact]
    public async Task DeleteAllDataAsync_RemovesEveryOwnedRowAcrossEveryTable_AndLeavesOtherUsersDataIntact()
    {
        var store = new AccountDeletionStore(_dbContext);

        await DeleteAllDataAsync(store, _userId);
        _dbContext.ChangeTracker.Clear();

        // Target user's data across every owned/indirectly-owned table is gone.
        Assert.False(await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == _userId));
        Assert.False(await _dbContext.ExternalIdentities.AsNoTracking().AnyAsync(e => e.UserId == _userId));
        Assert.False(await _dbContext.Items.AsNoTracking().AnyAsync(i => i.UserId == _userId));
        Assert.False(await _dbContext.ItemSaveRequests.AsNoTracking().AnyAsync(r => r.UserId == _userId));
        Assert.False(await _dbContext.ItemImages.AsNoTracking().AnyAsync(img => img.ItemId == _itemId));
        Assert.False(await _dbContext.RecentlyOpenedItems.AsNoTracking().AnyAsync(r => r.UserId == _userId));
        Assert.False(await _dbContext.Purchases.AsNoTracking().AnyAsync(p => p.UserId == _userId));
        Assert.False(await _dbContext.RepeatPurchases.AsNoTracking().AnyAsync(rp => rp.UserId == _userId));
        Assert.False(await _dbContext.Collections.AsNoTracking().AnyAsync(c => c.UserId == _userId));
        Assert.False(await _dbContext.CollectionItems.AsNoTracking().AnyAsync(ci => ci.CollectionId == _collectionId));
        Assert.False(await _dbContext.CollectionShares.AsNoTracking().AnyAsync(s => s.CollectionId == _collectionId));
        Assert.False(await _dbContext.Notifications.AsNoTracking().AnyAsync(n => n.UserId == _userId));
        Assert.False(await _dbContext.NotificationDeliveries.AsNoTracking()
            .AnyAsync(d => d.PushDeviceRegistrationId == _pushDeviceRegistrationId));
        Assert.False(await _dbContext.PushDeviceRegistrations.AsNoTracking().AnyAsync(p => p.UserId == _userId));

        // The other, unrelated user's data across every table is fully intact.
        Assert.True(await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == _otherUserId));
        Assert.True(await _dbContext.Items.AsNoTracking().AnyAsync(i => i.UserId == _otherUserId));
        Assert.True(await _dbContext.ItemSaveRequests.AsNoTracking().AnyAsync(r => r.UserId == _otherUserId));
        Assert.True(await _dbContext.RecentlyOpenedItems.AsNoTracking().AnyAsync(r => r.UserId == _otherUserId));
        Assert.True(await _dbContext.Purchases.AsNoTracking().AnyAsync(p => p.UserId == _otherUserId));
        Assert.True(await _dbContext.RepeatPurchases.AsNoTracking().AnyAsync(rp => rp.UserId == _otherUserId));
        Assert.True(await _dbContext.Collections.AsNoTracking().AnyAsync(c => c.UserId == _otherUserId));
        Assert.True(await _dbContext.CollectionItems.AsNoTracking().AnyAsync(ci => ci.CollectionId == _otherCollectionId));
        Assert.True(await _dbContext.CollectionShares.AsNoTracking().AnyAsync(s => s.CollectionId == _otherCollectionId));
        Assert.True(await _dbContext.Notifications.AsNoTracking().AnyAsync(n => n.UserId == _otherUserId));
        Assert.True(await _dbContext.PushDeviceRegistrations.AsNoTracking().AnyAsync(p => p.UserId == _otherUserId));
    }

    [Fact]
    public async Task DeleteAllDataAsync_ForAUserWithNoData_IsANoOp()
    {
        var extraUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(extraUser);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        try
        {
            var store = new AccountDeletionStore(_dbContext);
            await DeleteAllDataAsync(store, extraUser.Id);
            _dbContext.ChangeTracker.Clear();

            Assert.False(await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == extraUser.Id));
        }
        finally
        {
            // extraUser is local to this test - not _userId/_otherUserId - so DisposeAsync's own
            // cleanup doesn't know about the cleanup task this call durably registers (by design,
            // even for a no-op deletion - see AccountDeletionStore's own remarks).
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix = {$"items/{extraUser.Id}/"}");
        }
    }

    [Fact]
    public async Task DeleteAllDataAsync_WhenCancelledBeforeStarting_ThrowsAndDeletesNothingIncludingTheCleanupTask()
    {
        var store = new AccountDeletionStore(_dbContext);
        using var cancelledSource = new CancellationTokenSource();
        await cancelledSource.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => DeleteAllDataAsync(store, _userId, cancelledSource.Token));
        _dbContext.ChangeTracker.Clear();

        // The transaction must have rolled back rather than leaving a partial deletion - the
        // User row (the very last statement, so the strongest signal every earlier delete in the
        // same transaction was also undone) is still present.
        Assert.True(await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == _userId));
        Assert.True(await _dbContext.Notifications.AsNoTracking().AnyAsync(n => n.UserId == _userId));

        // The cleanup task registered as the FIRST statement inside the transaction must have
        // rolled back too - a failed account deletion must never leave an orphan cleanup task for
        // data that was never actually deleted.
        Assert.False(await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .AnyAsync(cleanup => cleanup.BlobPrefix == $"items/{_userId}/"));
    }

    [Fact]
    public async Task DeleteAllDataAsync_RegistersADurableBlobCleanupTask_CarryingOnlyThePrefix()
    {
        var store = new AccountDeletionStore(_dbContext);

        var cleanupTaskId = await DeleteAllDataAsync(store, _userId);
        _dbContext.ChangeTracker.Clear();

        var cleanupTask = await _dbContext.AccountDeletionBlobCleanups
            .AsNoTracking()
            .SingleAsync(cleanup => cleanup.Id == cleanupTaskId);
        Assert.Equal($"items/{_userId}/", cleanupTask.BlobPrefix);
        Assert.Equal(0, cleanupTask.AttemptCount);
        Assert.Null(cleanupTask.LastAttemptAtUtc);
        Assert.Null(cleanupTask.LastErrorCode);
        Assert.Null(cleanupTask.FinalSweepAfterUtc);
        // The whole point of this table (see AccountDeletionBlobCleanup's own remarks) is that it
        // carries nothing beyond the prefix - no UserId column exists on it at all to assert
        // against; BlobPrefix itself is the only place a UserId-shaped value could appear, and
        // it's exactly and only the prefix, nothing more (e.g. no URL/email/token appended).
    }

    [Fact]
    public async Task DeleteAllDataAsync_DeactivatesThePublicShare_SoItNoLongerResolves()
    {
        var publicCollectionStore = new PublicCollectionStore(_dbContext);
        var beforeDelete = await publicCollectionStore.GetCollectionAsync(_publicId);
        Assert.NotNull(beforeDelete);

        var store = new AccountDeletionStore(_dbContext);
        await DeleteAllDataAsync(store, _userId);
        _dbContext.ChangeTracker.Clear();

        var afterDelete = await publicCollectionStore.GetCollectionAsync(_publicId);
        Assert.Null(afterDelete);
    }

}
