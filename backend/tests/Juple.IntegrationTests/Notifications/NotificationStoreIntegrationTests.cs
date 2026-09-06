using Juple.Application.Notifications;
using Juple.Application.Purchases;
using Juple.Application.RepeatPurchases;
using Juple.Domain.Items;
using Juple.Domain.Notifications;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.RepeatPurchases;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Notifications;

public sealed class NotificationStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run Notification store integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/notification-store-test", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM notifications.Notifications WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private async Task<RepeatPurchaseDto> CreateRepeatPurchaseAsync(
        long userId,
        DateOnly nextPurchaseDate,
        string productName = "Repeat Test Product",
        long? itemId = null,
        bool isEnabled = true)
    {
        var store = new RepeatPurchaseStore(_dbContext);
        var created = await store.CreateAsync(
            userId,
            new RepeatPurchaseFields(itemId, productName, 30, IntervalUnit.Day, nextPurchaseDate, false, 0),
            DateTimeOffset.UtcNow);
        if (!isEnabled)
        {
            created = await store.DisableAsync(userId, created.Id, DateTimeOffset.UtcNow);
        }

        _dbContext.ChangeTracker.Clear();
        return created;
    }

    private NotificationStore NewStore() => new(_dbContext);

    [Fact]
    public async Task MaterializeDueAsync_WhenNextPurchaseDateIsTodayLocal_CreatesNotification()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6), itemId: _itemId);
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        var notification = Assert.Single(page.Notifications);
        Assert.Equal(NotificationType.RepeatPurchaseDue, notification.Type);
        Assert.Equal(repeatPurchase.Id, notification.RepeatPurchaseId);
        Assert.Equal(_itemId, notification.ItemId);
        Assert.Equal("Repeat Test Product", notification.ProductNameSnapshot);
        Assert.Equal(new DateOnly(2026, 9, 6), notification.DueDate);
        Assert.Null(notification.ReadAtUtc);
    }

    [Fact]
    public async Task MaterializeDueAsync_WhenNextPurchaseDateIsOverdue_CreatesNotification()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 8, 1));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_WhenNextPurchaseDateIsInFuture_CreatesNoNotification()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 10, 1));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_WhenRepeatPurchaseIsDisabled_CreatesNoNotification()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6), isEnabled: false);
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_CalledTwice_DoesNotCreateDuplicateForSameDueCycle()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);
        _dbContext.ChangeTracker.Clear();
        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_ConcurrentCallsFromIndependentContexts_DoesNotCreateDuplicate()
    {
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var storeA = new NotificationStore(contextA);
        var storeB = new NotificationStore(contextB);

        await Task.WhenAll(
            storeA.MaterializeDueAsync(_userId, "UTC", nowUtc),
            storeB.MaterializeDueAsync(_userId, "UTC", nowUtc));

        _dbContext.ChangeTracker.Clear();
        var page = await NewStore().ListAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_UsesUsersLocalDateNotUtcDate()
    {
        // 2026-09-06T16:00:00Z is already 2026-09-07 01:00 in Asia/Seoul (UTC+9) - a RepeatPurchase
        // due on 2026-09-07 must be materialized here, which only happens if the local (Seoul) date
        // is used rather than the still-2026-09-06 UTC date.
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 7));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 16, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "Asia/Seoul", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Notifications);
    }

    [Fact]
    public async Task MaterializeDueAsync_AfterLogPurchaseAdvancesToANewAlreadyDueDate_CreatesNotificationForNewCycle()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1));
        var firstDueUtc = new DateTimeOffset(2026, 9, 1, 3, 0, 0, TimeSpan.Zero);
        await store.MaterializeDueAsync(_userId, "UTC", firstDueUtc);
        _dbContext.ChangeTracker.Clear();
        var firstNotification = Assert.Single((await store.ListAsync(_userId, cursor: null, limit: 50)).Notifications);

        // Logging a purchase advances NextPurchaseDate by the interval (30 days: 2026-09-01 -> 10-01),
        // but "now" has already reached 10-02 - the new cycle is itself already due too.
        var logPurchaseStore = new LogPurchaseStore(_dbContext);
        await logPurchaseStore.LogAsync(
            _userId,
            repeatPurchase.Id,
            new PurchaseFields(null, "Repeat Test Product", new DateOnly(2026, 9, 1), null, null, null, null, null, null),
            repeatPurchase.Version,
            new DateTimeOffset(2026, 9, 1, 3, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();

        var secondDueUtc = new DateTimeOffset(2026, 10, 2, 3, 0, 0, TimeSpan.Zero);
        await store.MaterializeDueAsync(_userId, "UTC", secondDueUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Equal(2, page.Notifications.Count);
        Assert.Contains(page.Notifications, n => n.Id == firstNotification.Id && n.DueDate == new DateOnly(2026, 9, 1));
        Assert.Contains(page.Notifications, n => n.DueDate == new DateOnly(2026, 10, 1));
    }

    [Fact]
    public async Task MaterializeDueAsync_OnlyMaterializesForRequestedUser()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_otherUserId, new DateOnly(2026, 9, 6));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var mine = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(mine.Notifications);
    }

    [Fact]
    public async Task ListAsync_OrdersByCreatedAtUtcDescendingThenIdDescending()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1), "First");
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 2), "Second");
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero));

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(2, page.Notifications.Count);
        Assert.Equal("Second", page.Notifications[0].ProductNameSnapshot);
        Assert.Equal("First", page.Notifications[1].ProductNameSnapshot);
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersNotifications()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6));
        await CreateRepeatPurchaseAsync(_otherUserId, new DateOnly(2026, 9, 6));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);
        await store.MaterializeDueAsync(_otherUserId, "UTC", nowUtc);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Notifications);
    }

    [Fact]
    public async Task ListAsync_WithLimitLessThanTotal_PagesViaCursorWithoutDuplicateOrMissingRows()
    {
        var store = NewStore();
        for (var day = 1; day <= 5; day++)
        {
            await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, day), $"Product {day}");
            await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, day, 0, 0, 0, TimeSpan.Zero));
            _dbContext.ChangeTracker.Clear();
        }

        var expectedOrder = (await store.ListAsync(_userId, cursor: null, limit: 50)).Notifications
            .Select(n => n.Id).ToList();
        Assert.Equal(5, expectedOrder.Count);

        var firstPage = await store.ListAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(expectedOrder.Take(2), firstPage.Notifications.Select(n => n.Id));
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(_userId, firstPage.NextCursor, limit: 2);
        Assert.Equal(expectedOrder.Skip(2).Take(2), secondPage.Notifications.Select(n => n.Id));
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.ListAsync(_userId, secondPage.NextCursor, limit: 2);
        Assert.Equal(expectedOrder.Skip(4).Take(2), thirdPage.Notifications.Select(n => n.Id));
        Assert.Null(thirdPage.NextCursor);
    }

    [Fact]
    public async Task GetUnreadCountAsync_CountsOnlyUnreadNotificationsForThatUser()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1), "First");
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 2), "Second");
        await CreateRepeatPurchaseAsync(_otherUserId, new DateOnly(2026, 9, 1), "Theirs");
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero));
        await store.MaterializeDueAsync(_otherUserId, "UTC", new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        var mine = await store.ListAsync(_userId, cursor: null, limit: 50);
        await store.MarkReadAsync(_userId, mine.Notifications[0].Id, DateTimeOffset.UtcNow);

        _dbContext.ChangeTracker.Clear();
        var unreadCount = await store.GetUnreadCountAsync(_userId);

        Assert.Equal(1, unreadCount);
    }

    [Fact]
    public async Task MarkReadAsync_MarksThatNotificationReadAndLeavesOthersUntouched()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1), "First");
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 2), "Second");
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        var toMarkRead = page.Notifications.First(n => n.ProductNameSnapshot == "First");
        var readAtUtc = DateTimeOffset.UtcNow;

        await store.MarkReadAsync(_userId, toMarkRead.Id, readAtUtc);

        _dbContext.ChangeTracker.Clear();
        var reloaded = await store.ListAsync(_userId, cursor: null, limit: 50);
        var read = reloaded.Notifications.Single(n => n.Id == toMarkRead.Id);
        var stillUnread = reloaded.Notifications.Single(n => n.ProductNameSnapshot == "Second");
        Assert.Equal(readAtUtc, read.ReadAtUtc);
        Assert.Null(stillUnread.ReadAtUtc);
    }

    [Fact]
    public async Task MarkReadAsync_WhenAlreadyRead_IsIdempotentAndLeavesReadAtUtcUnchanged()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1));
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        var notification = Assert.Single((await store.ListAsync(_userId, cursor: null, limit: 50)).Notifications);
        var firstReadAtUtc = DateTimeOffset.UtcNow;
        await store.MarkReadAsync(_userId, notification.Id, firstReadAtUtc);
        _dbContext.ChangeTracker.Clear();

        await store.MarkReadAsync(_userId, notification.Id, firstReadAtUtc.AddMinutes(5));

        _dbContext.ChangeTracker.Clear();
        var reloaded = Assert.Single((await store.ListAsync(_userId, cursor: null, limit: 50)).Notifications);
        Assert.Equal(firstReadAtUtc, reloaded.ReadAtUtc);
    }

    [Fact]
    public async Task MarkReadAsync_WhenNotificationDoesNotExist_ThrowsNotificationNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<NotificationNotFoundException>(
            () => store.MarkReadAsync(_userId, notificationId: -1, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task MarkReadAsync_OnAnotherUsersNotification_ThrowsNotificationNotFound()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_otherUserId, new DateOnly(2026, 9, 1));
        await store.MaterializeDueAsync(_otherUserId, "UTC", new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        var theirs = Assert.Single((await store.ListAsync(_otherUserId, cursor: null, limit: 50)).Notifications);

        await Assert.ThrowsAsync<NotificationNotFoundException>(
            () => store.MarkReadAsync(_userId, theirs.Id, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task MarkAllReadAsync_MarksEveryUnreadNotificationForThatUserAndLeavesOtherUsersUntouched()
    {
        var store = NewStore();
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1), "Mine 1");
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 2), "Mine 2");
        await CreateRepeatPurchaseAsync(_otherUserId, new DateOnly(2026, 9, 1), "Theirs");
        var nowUtc = new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero);
        await store.MaterializeDueAsync(_userId, "UTC", nowUtc);
        await store.MaterializeDueAsync(_otherUserId, "UTC", nowUtc);
        _dbContext.ChangeTracker.Clear();
        var readAtUtc = DateTimeOffset.UtcNow;

        await store.MarkAllReadAsync(_userId, readAtUtc);

        _dbContext.ChangeTracker.Clear();
        Assert.Equal(0, await store.GetUnreadCountAsync(_userId));
        Assert.Equal(1, await store.GetUnreadCountAsync(_otherUserId));
    }

    [Fact]
    public async Task MarkAllReadAsync_WhenNoneAreUnread_IsANoOp()
    {
        var store = NewStore();

        await store.MarkAllReadAsync(_userId, DateTimeOffset.UtcNow);

        Assert.Equal(0, await store.GetUnreadCountAsync(_userId));
    }

    [Fact]
    public async Task DeletingTheRepeatPurchase_CascadesToDeleteItsNotifications()
    {
        var store = NewStore();
        var repeatPurchase = await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 1));
        await store.MaterializeDueAsync(_userId, "UTC", new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero));
        _dbContext.ChangeTracker.Clear();
        Assert.Single((await store.ListAsync(_userId, cursor: null, limit: 50)).Notifications);

        await new RepeatPurchaseStore(_dbContext).DeleteAsync(_userId, repeatPurchase.Id);

        _dbContext.ChangeTracker.Clear();
        var page = await store.ListAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(page.Notifications);
    }

    [Fact]
    public void IndexModel_TypeRepeatPurchaseIdDueDateUnique_ExistsForRaceSafeDuplicatePrevention()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(Notification))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "UX_Notifications_Type_RepeatPurchaseId_DueDate");

        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
        // Type is included (even though only RepeatPurchaseDue exists today) so this constraint is
        // scoped per-Type - a future Type never collides with RepeatPurchaseDue's own uniqueness.
        Assert.Equal(new[] { "Type", "RepeatPurchaseId", "DueDate" }, index.Properties.Select(p => p.Name));
    }

    [Fact]
    public void IndexModel_UserIdCreatedAtUtcId_ExistsForNewestFirstListingQueries()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(Notification))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_Notifications_UserId_CreatedAtUtc_Id");

        Assert.NotNull(index);
        Assert.Equal(new[] { "UserId", "CreatedAtUtc", "Id" }, index!.Properties.Select(p => p.Name));
    }
}
