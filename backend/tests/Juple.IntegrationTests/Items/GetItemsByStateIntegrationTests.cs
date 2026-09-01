using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class GetItemsByStateIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item state query integration tests " +
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
    public async Task GetByStateAsync_Wishlist_ExcludesInboxAndArchived()
    {
        var store = new ItemStore(_dbContext);
        await SaveAsync(store, "https://shop.example/wishlist-only-inbox");
        var wishlistItem = await SaveAsync(store, "https://shop.example/wishlist-only-wishlist");
        var archivedItem = await SaveAsync(store, "https://shop.example/wishlist-only-archived");

        await store.MoveToWishlistAsync(_userId, wishlistItem, DateTimeOffset.UtcNow);
        await store.MoveToArchiveAsync(_userId, archivedItem, DateTimeOffset.UtcNow);

        var page = await store.GetByStateAsync(_userId, ItemState.Wishlist, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(wishlistItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByStateAsync_Archived_ReturnsOnlyArchivedItems()
    {
        var store = new ItemStore(_dbContext);
        var wishlistItem = await SaveAsync(store, "https://shop.example/archived-only-wishlist");
        var archivedItem = await SaveAsync(store, "https://shop.example/archived-only-archived");

        await store.MoveToWishlistAsync(_userId, wishlistItem, DateTimeOffset.UtcNow);
        await store.MoveToArchiveAsync(_userId, archivedItem, DateTimeOffset.UtcNow);

        var page = await store.GetByStateAsync(_userId, ItemState.Archived, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(archivedItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByStateAsync_ExcludesOtherUsersItems()
    {
        var store = new ItemStore(_dbContext);
        var myItem = await SaveAsync(store, "https://shop.example/ownership-mine");
        await store.MoveToWishlistAsync(_userId, myItem, DateTimeOffset.UtcNow);

        var otherSaved = await store.SaveAsync(
            _otherUserId, "https://shop.example/ownership-other", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.MoveToWishlistAsync(_otherUserId, otherSaved.Entry.Id, DateTimeOffset.UtcNow);

        var page = await store.GetByStateAsync(_userId, ItemState.Wishlist, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(myItem, page.Items[0].Id);
    }

    [Fact]
    public async Task GetByStateAsync_OrdersByStateChangedAtUtcDescendingThenIdDescending()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;

        var first = await SaveAsync(store, "https://shop.example/order-1");
        var second = await SaveAsync(store, "https://shop.example/order-2");
        var third = await SaveAsync(store, "https://shop.example/order-3");

        await store.MoveToWishlistAsync(_userId, first, baseTime);
        await store.MoveToWishlistAsync(_userId, second, baseTime.AddMinutes(1));
        await store.MoveToWishlistAsync(_userId, third, baseTime.AddMinutes(2));

        var page = await store.GetByStateAsync(_userId, ItemState.Wishlist, cursor: null, limit: 50);

        Assert.Equal(new[] { third, second, first }, page.Items.Select(item => item.Id));
    }

    [Fact]
    public async Task GetByStateAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var id = await SaveAsync(store, $"https://shop.example/limit-{i}");
            await store.MoveToWishlistAsync(_userId, id, baseTime.AddMinutes(i));
            ids.Add(id);
        }

        var firstPage = await store.GetByStateAsync(_userId, ItemState.Wishlist, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.GetByStateAsync(
            _userId, ItemState.Wishlist, firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.GetByStateAsync(
            _userId, ItemState.Wishlist, secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetByStateAsync_WhenStateChangedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new ItemStore(_dbContext);
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var id = await SaveAsync(store, $"https://shop.example/tie-{i}");
            await store.MoveToWishlistAsync(_userId, id, sameTime);
            ids.Add(id);
        }

        var firstPage = await store.GetByStateAsync(_userId, ItemState.Wishlist, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.GetByStateAsync(
            _userId, ItemState.Wishlist, firstPage.NextCursor, limit: 2);
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
