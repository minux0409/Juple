using Juple.Application.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class RecentlyOpenedItemIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run recently-opened-item integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.RecentlyOpenedItems WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private JupleDbContext NewDbContext() =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<long> CreateItemAsync(string url)
    {
        var itemStore = new ItemStore(_dbContext);
        var result = await itemStore.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }

    [Fact]
    public async Task RecordOpenAsync_FirstOpen_CreatesRow()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-first-open");

        await store.RecordOpenAsync(_userId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Items);
        Assert.Equal(itemId, page.Items[0].ItemId);
    }

    [Fact]
    public async Task RecordOpenAsync_SameItemOpenedAgain_DoesNotAddRow_UpdatesTimestamp()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-reopen");
        var firstOpen = DateTimeOffset.UtcNow.AddMinutes(-10);
        var secondOpen = DateTimeOffset.UtcNow;

        await store.RecordOpenAsync(_userId, itemId, firstOpen);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, itemId, secondOpen);
        _dbContext.ChangeTracker.Clear();

        var rowCount = await _dbContext.RecentlyOpenedItems
            .CountAsync(entry => entry.UserId == _userId && entry.ItemId == itemId);
        Assert.Equal(1, rowCount);

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Items);
        Assert.Equal(secondOpen, page.Items[0].LastOpenedAtUtc);
    }

    [Fact]
    public async Task RecordOpenAsync_OlderTimestampThanExisting_DoesNotRegressLastOpenedAtUtc()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-no-regress");
        var later = DateTimeOffset.UtcNow;
        var earlier = later.AddMinutes(-30);

        await store.RecordOpenAsync(_userId, itemId, later);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, itemId, earlier);
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);
        Assert.Equal(later, page.Items[0].LastOpenedAtUtc);
    }

    [Fact]
    public async Task RecordOpenAsync_WhenItemBelongsToAnotherUser_ThrowsItemNotFoundException()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-other-user-item");

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.RecordOpenAsync(_otherUserId, itemId, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task RecordOpenAsync_WhenItemDoesNotExist_ThrowsItemNotFoundException()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.RecordOpenAsync(_userId, itemId: -1, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task RecordOpenAsync_ConcurrentSameItemOpen_NeverThrowsAndLeavesOneRow()
    {
        // Two independent DbContext instances racing to insert the first row for the same
        // (userId, itemId) pair - the loser must hit UX_RecentlyOpenedItems_UserId_ItemId and
        // absorb it (see RecentlyOpenedItemStore.RecordOpenAsync's catch), never surface a
        // unique-constraint DbUpdateException to the caller.
        var itemId = await CreateItemAsync("https://shop.example/recent-concurrent-open");
        var openedAt = DateTimeOffset.UtcNow;

        await using var dbContextA = NewDbContext();
        await using var dbContextB = NewDbContext();
        var storeA = new RecentlyOpenedItemStore(dbContextA);
        var storeB = new RecentlyOpenedItemStore(dbContextB);

        var taskA = storeA.RecordOpenAsync(_userId, itemId, openedAt);
        var taskB = storeB.RecordOpenAsync(_userId, itemId, openedAt);

        var exception = await Record.ExceptionAsync(() => Task.WhenAll(taskA, taskB));
        Assert.Null(exception);

        var rowCount = await _dbContext.RecentlyOpenedItems
            .CountAsync(entry => entry.UserId == _userId && entry.ItemId == itemId);
        Assert.Equal(1, rowCount);
    }

    [Fact]
    public async Task GetPageAsync_OrdersByLastOpenedAtUtcDescendingThenItemIdDescending()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var itemA = await CreateItemAsync("https://shop.example/recent-order-a");
        var itemB = await CreateItemAsync("https://shop.example/recent-order-b");
        var itemC = await CreateItemAsync("https://shop.example/recent-order-c");

        await store.RecordOpenAsync(_userId, itemA, baseTime);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, itemB, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, itemC, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(new[] { itemC, itemB, itemA }, page.Items.Select(item => item.ItemId));
    }

    [Fact]
    public async Task GetPageAsync_ReopeningAnItem_MovesItToTheTop()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var itemA = await CreateItemAsync("https://shop.example/recent-reopen-order-a");
        var itemB = await CreateItemAsync("https://shop.example/recent-reopen-order-b");

        await store.RecordOpenAsync(_userId, itemA, baseTime);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, itemB, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();

        // Re-opening the older Item must move it above the one opened after it originally.
        await store.RecordOpenAsync(_userId, itemA, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(new[] { itemA, itemB }, page.Items.Select(item => item.ItemId));
    }

    [Fact]
    public async Task GetPageAsync_WhenLastOpenedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var itemId = await CreateItemAsync($"https://shop.example/recent-tie-{i}");
            await store.RecordOpenAsync(_userId, itemId, sameTime);
            _dbContext.ChangeTracker.Clear();
            ids.Add(itemId);
        }

        var firstPage = await store.GetPageAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.GetPageAsync(_userId, firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(item => item.ItemId).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetPageAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var itemId = await CreateItemAsync($"https://shop.example/recent-paging-{i}");
            await store.RecordOpenAsync(_userId, itemId, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            ids.Add(itemId);
        }

        var firstPage = await store.GetPageAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.GetPageAsync(_userId, firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.GetPageAsync(_userId, secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.ItemId)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.AsEnumerable().Reverse(), allReturnedIds);
    }

    [Fact]
    public async Task GetPageAsync_ExcludesOtherUsersEntries()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var myItem = await CreateItemAsync("https://shop.example/recent-ownership-mine");
        var otherItemStore = new ItemStore(_dbContext);
        var otherItemResult = await otherItemStore.SaveAsync(
            _otherUserId, "https://shop.example/recent-ownership-other", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.RecordOpenAsync(_userId, myItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_otherUserId, otherItemResult.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(myItem, page.Items[0].ItemId);
    }

    [Fact]
    public async Task GetPageAsync_ReturnsCurrentItemTitleAndUrl()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-details");
        await itemStore.UpdateDetailsAsync(_userId, itemId, "My Title", memo: null);
        _dbContext.ChangeTracker.Clear();

        await store.RecordOpenAsync(_userId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);

        Assert.Equal("My Title", page.Items[0].Title);
        Assert.Equal("https://shop.example/recent-details", page.Items[0].Url);
    }

    [Fact]
    public async Task DeleteAsync_RemovesOnlyTheSpecifiedEntry()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var keptItem = await CreateItemAsync("https://shop.example/recent-delete-kept");
        var deletedItem = await CreateItemAsync("https://shop.example/recent-delete-removed");
        await store.RecordOpenAsync(_userId, keptItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_userId, deletedItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, deletedItem);
        _dbContext.ChangeTracker.Clear();

        var page = await store.GetPageAsync(_userId, cursor: null, limit: 50);
        Assert.Single(page.Items);
        Assert.Equal(keptItem, page.Items[0].ItemId);
    }

    [Fact]
    public async Task DeleteAsync_WhenNoEntryExists_IsIdempotent()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-delete-missing");

        var exception = await Record.ExceptionAsync(() => store.DeleteAsync(_userId, itemId));

        Assert.Null(exception);
    }

    [Fact]
    public async Task DeleteAsync_CannotRemoveAnotherUsersEntry()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var otherItemStore = new ItemStore(_dbContext);
        var otherItemResult = await otherItemStore.SaveAsync(
            _otherUserId, "https://shop.example/recent-delete-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_otherUserId, otherItemResult.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        // Attempting to delete the other user's entry by its ItemId must not remove it.
        await store.DeleteAsync(_userId, otherItemResult.Entry.Id);
        _dbContext.ChangeTracker.Clear();

        var otherUsersPage = await store.GetPageAsync(_otherUserId, cursor: null, limit: 50);
        Assert.Single(otherUsersPage.Items);
    }

    [Fact]
    public async Task DeleteAllAsync_RemovesOnlyCurrentUsersEntries()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var myItem = await CreateItemAsync("https://shop.example/recent-delete-all-mine");
        var otherItemStore = new ItemStore(_dbContext);
        var otherItemResult = await otherItemStore.SaveAsync(
            _otherUserId, "https://shop.example/recent-delete-all-other", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.RecordOpenAsync(_userId, myItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.RecordOpenAsync(_otherUserId, otherItemResult.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAllAsync(_userId);
        _dbContext.ChangeTracker.Clear();

        var myPage = await store.GetPageAsync(_userId, cursor: null, limit: 50);
        Assert.Empty(myPage.Items);

        var otherPage = await store.GetPageAsync(_otherUserId, cursor: null, limit: 50);
        Assert.Single(otherPage.Items);
    }

    [Fact]
    public async Task DeleteAllAsync_WhenNoEntriesExist_IsIdempotent()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);

        var exception = await Record.ExceptionAsync(() => store.DeleteAllAsync(_userId));

        Assert.Null(exception);
    }

    [Fact]
    public async Task DeletingTheItem_CascadesToRemoveItsRecentlyOpenedEntry()
    {
        var store = new RecentlyOpenedItemStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var itemId = await CreateItemAsync("https://shop.example/recent-item-delete-cascade");
        await store.RecordOpenAsync(_userId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await itemStore.DeleteAsync(_userId, itemId);
        _dbContext.ChangeTracker.Clear();

        var rowCount = await _dbContext.RecentlyOpenedItems
            .CountAsync(entry => entry.UserId == _userId && entry.ItemId == itemId);
        Assert.Equal(0, rowCount);
    }
}
