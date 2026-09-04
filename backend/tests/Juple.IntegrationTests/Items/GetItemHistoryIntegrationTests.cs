using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class GetItemHistoryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item history query integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
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
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task GetHistoryAsync_ExcludesOtherUsersItems()
    {
        var store = new ItemStore(_dbContext);
        var myItem = await SaveAsync(store, "https://shop.example/history-ownership-mine");
        await store.SaveAsync(_otherUserId, "https://shop.example/history-ownership-other", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(myItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetHistoryAsync_IncludesItemsRegardlessOfCurrentState()
    {
        var store = new ItemStore(_dbContext);
        var inboxItem = await SaveAsync(store, "https://shop.example/history-state-inbox");
        var wishlistItem = await SaveAsync(store, "https://shop.example/history-state-wishlist");
        var archivedItem = await SaveAsync(store, "https://shop.example/history-state-archived");

        await store.MoveToWishlistAsync(_userId, wishlistItem, DateTimeOffset.UtcNow);
        await store.MoveToArchiveAsync(_userId, archivedItem, DateTimeOffset.UtcNow);

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        var returnedIds = page.Items.Select(item => item.Id).ToList();
        Assert.Contains(inboxItem, returnedIds);
        Assert.Contains(wishlistItem, returnedIds);
        Assert.Contains(archivedItem, returnedIds);
    }

    [Fact]
    public async Task GetHistoryAsync_StateChangeAfterSave_DoesNotMoveItInHistoryOrder()
    {
        // History orders by the original SavedAtUtc, never StateChangedAtUtc - moving an Item to
        // Wishlist long after saving it must not resurface it at the top of History.
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow.AddDays(-1);

        var older = await store.SaveAsync(_userId, "https://shop.example/history-order-older", null, baseTime);
        _dbContext.ChangeTracker.Clear();
        var newer = await store.SaveAsync(
            _userId, "https://shop.example/history-order-newer", null, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();

        // The older Item transitions to Wishlist well after the newer Item was saved - its
        // SavedAtUtc (and hence its History position) must not change.
        await store.MoveToWishlistAsync(_userId, older.Entry.Id, DateTimeOffset.UtcNow);

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(new[] { newer.Entry.Id, older.Entry.Id }, page.Items.Select(item => item.Id));
    }

    [Fact]
    public async Task GetHistoryAsync_ExcludesDeletedItems()
    {
        var store = new ItemStore(_dbContext);
        var keptItem = await SaveAsync(store, "https://shop.example/history-delete-kept");
        var deletedItem = await SaveAsync(store, "https://shop.example/history-delete-removed");

        await store.DeleteAsync(_userId, deletedItem);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(keptItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetHistoryAsync_OrdersBySavedAtUtcDescendingThenIdDescending()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;

        var first = await store.SaveAsync(_userId, "https://shop.example/history-sort-1", null, baseTime);
        _dbContext.ChangeTracker.Clear();
        var second = await store.SaveAsync(
            _userId, "https://shop.example/history-sort-2", null, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();
        var third = await store.SaveAsync(
            _userId, "https://shop.example/history-sort-3", null, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.Equal(
            new[] { third.Entry.Id, second.Entry.Id, first.Entry.Id },
            page.Items.Select(item => item.Id));
    }

    [Fact]
    public async Task GetHistoryAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var result = await store.SaveAsync(
                _userId, $"https://shop.example/history-paging-{i}", null, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _) = await store.GetHistoryAsync(_userId, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var (thirdPage, _) = await store.GetHistoryAsync(_userId, cursor: secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetHistoryAsync_WhenSavedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var result = await store.SaveAsync(_userId, $"https://shop.example/history-tie-{i}", null, sameTime);
            _dbContext.ChangeTracker.Clear();
            ids.Add(result.Entry.Id);
        }

        var (firstPage, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _) = await store.GetHistoryAsync(_userId, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(item => item.Id).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    private async Task<long> SaveAsync(ItemStore store, string url)
    {
        var result = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }
}
