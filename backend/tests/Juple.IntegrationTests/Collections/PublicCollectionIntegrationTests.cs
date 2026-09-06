using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

public sealed class PublicCollectionIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run public collection integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.CollectionShares WHERE CollectionId IN (SELECT Id FROM collections.Collections WHERE UserId = {_userId})");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.CollectionItems WHERE CollectionId IN (SELECT Id FROM collections.Collections WHERE UserId = {_userId})");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.Collections WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    private static string NewCandidatePublicId() => Guid.NewGuid().ToString("N");

    private async Task<long> CreateCollectionAsync(CollectionStore store, string name) =>
        (await store.CreateAsync(_userId, name, name.ToUpperInvariant(), DateTimeOffset.UtcNow)).Id;

    private async Task<long> CreateItemAsync(ItemStore itemStore, string url, string? title = null)
    {
        var result = await itemStore.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        if (title is not null)
        {
            await itemStore.UpdateDetailsAsync(_userId, result.Entry.Id, title, memo: null);
            _dbContext.ChangeTracker.Clear();
        }
        return result.Entry.Id;
    }

    [Fact]
    public async Task GetCollectionAsync_WhenActive_ReturnsNameOnly()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var result = await publicStore.GetCollectionAsync(share.PublicId);

        Assert.NotNull(result);
        Assert.Equal("Travel", result!.Name);
    }

    [Fact]
    public async Task GetCollectionAsync_WhenUnknownPublicId_ReturnsNull()
    {
        var publicStore = new PublicCollectionStore(_dbContext);

        var result = await publicStore.GetCollectionAsync("does-not-exist");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetCollectionAsync_WhenRevoked_ReturnsNull()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var result = await publicStore.GetCollectionAsync(share.PublicId);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetItemsAsync_ReturnsTitleAndUrlOnly_NoPrivateFields()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        var itemId = await CreateItemAsync(itemStore, "https://shop.example/public-item", "My Title");
        await collectionStore.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var page = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);

        Assert.NotNull(page);
        var item = Assert.Single(page!.Items);
        Assert.Equal("My Title", item.Title);
        Assert.Equal("https://shop.example/public-item", item.Url);
    }

    [Fact]
    public async Task GetItemsAsync_WhenUnknownPublicId_ReturnsNull()
    {
        var publicStore = new PublicCollectionStore(_dbContext);

        var page = await publicStore.GetItemsAsync("does-not-exist", cursor: null, limit: 50);

        Assert.Null(page);
    }

    [Fact]
    public async Task GetItemsAsync_WhenRevoked_ReturnsNull()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var page = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);

        Assert.Null(page);
    }

    [Fact]
    public async Task GetItemsAsync_OrderedByAddedAtUtcDescendingThenItemIdDescending()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        var baseTime = DateTimeOffset.UtcNow;
        var itemA = await CreateItemAsync(itemStore, "https://shop.example/order-a");
        var itemB = await CreateItemAsync(itemStore, "https://shop.example/order-b");
        var itemC = await CreateItemAsync(itemStore, "https://shop.example/order-c");
        await collectionStore.AddAsync(_userId, collectionId, itemA, baseTime);
        _dbContext.ChangeTracker.Clear();
        await collectionStore.AddAsync(_userId, collectionId, itemB, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();
        await collectionStore.AddAsync(_userId, collectionId, itemC, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var page = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);

        Assert.NotNull(page);
        Assert.Equal(
            ["https://shop.example/order-c", "https://shop.example/order-b", "https://shop.example/order-a"],
            page!.Items.Select(i => i.Url));
    }

    [Fact]
    public async Task GetItemsAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        var baseTime = DateTimeOffset.UtcNow;
        var urls = new List<string>();
        for (var i = 0; i < 5; i++)
        {
            var url = $"https://shop.example/page-{i}";
            var itemId = await CreateItemAsync(itemStore, url);
            await collectionStore.AddAsync(_userId, collectionId, itemId, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            urls.Add(url);
        }
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var firstPage = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 2);
        Assert.NotNull(firstPage);
        Assert.Equal(2, firstPage!.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await publicStore.GetItemsAsync(share.PublicId, firstPage.NextCursor, limit: 2);
        Assert.NotNull(secondPage);
        Assert.Equal(2, secondPage!.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await publicStore.GetItemsAsync(share.PublicId, secondPage.NextCursor, limit: 2);
        Assert.NotNull(thirdPage);
        Assert.Single(thirdPage!.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedUrls = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(i => i.Url)
            .ToList();
        Assert.Equal(5, allReturnedUrls.Distinct().Count());
        Assert.Equal(urls.AsEnumerable().Reverse(), allReturnedUrls);
    }

    [Fact]
    public async Task GetItemsAsync_AfterItemRemovedFromCollection_NoLongerAppears()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        var itemId = await CreateItemAsync(itemStore, "https://shop.example/removed-item");
        await collectionStore.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        var beforeRemoval = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);
        Assert.Single(beforeRemoval!.Items);

        await collectionStore.RemoveAsync(_userId, collectionId, itemId);
        _dbContext.ChangeTracker.Clear();

        var afterRemoval = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);
        Assert.Empty(afterRemoval!.Items);
    }

    [Fact]
    public async Task GetItemsAsync_AfterItemDeleted_NoLongerAppears()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, "Travel");
        var itemId = await CreateItemAsync(itemStore, "https://shop.example/deleted-item");
        await collectionStore.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var publicStore = new PublicCollectionStore(_dbContext);

        await itemStore.DeleteAsync(_userId, itemId);
        _dbContext.ChangeTracker.Clear();

        var afterDelete = await publicStore.GetItemsAsync(share.PublicId, cursor: null, limit: 50);
        Assert.Empty(afterDelete!.Items);
    }
}
