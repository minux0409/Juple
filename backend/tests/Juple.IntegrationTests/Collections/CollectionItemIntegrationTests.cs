using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

public sealed class CollectionItemIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run collection item integration " +
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
        // Must run before the Collections delete below - CollectionMergeOperations has a NoAction
        // FK to Collections/Users (see CollectionMergeOperationConfiguration), so a leftover
        // operation row would otherwise block those deletes. Cascades away any
        // CollectionMergeCreatedMemberships rows with it.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.CollectionMergeOperations WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.CollectionItems WHERE CollectionId IN (SELECT Id FROM collections.Collections WHERE UserId = {_userId} OR UserId = {_otherUserId})");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.Collections WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private async Task<long> CreateCollectionAsync(CollectionStore store, long userId, string name) =>
        (await store.CreateAsync(userId, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

    private async Task<long> CreateItemAsync(ItemStore itemStore, long userId, string url)
    {
        var result = await itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return result.Entry.Id;
    }

    [Fact]
    public async Task AddAsync_AddsMembership_ReflectedInGetItemsAsync()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-add-a");

        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Single(page.Items);
        Assert.Equal(itemId, page.Items[0].ItemId);
    }

    [Fact]
    public async Task AddAsync_SameItemInMultipleCollections_Allowed()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionA = await CreateCollectionAsync(store, _userId, "Books");
        var collectionB = await CreateCollectionAsync(store, _userId, "Wishlist gifts");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-multi");

        await store.AddAsync(_userId, collectionA, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionB, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (pageA, _, _) = await store.GetItemsAsync(_userId, collectionA, cursor: null, limit: 50);
        var (pageB, _, _) = await store.GetItemsAsync(_userId, collectionB, cursor: null, limit: 50);
        Assert.Single(pageA.Items, item => item.ItemId == itemId);
        Assert.Single(pageB.Items, item => item.ItemId == itemId);
    }

    [Fact]
    public async Task AddAsync_DuplicateAdd_IsIdempotentNoOpWithoutDuplicateRow()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-dup");

        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow.AddMinutes(5));
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Single(page.Items);
    }

    [Fact]
    public async Task AddAsync_ConcurrentDuplicateAdd_ResultsInExactlyOneRowAndBothCallsSucceed()
    {
        // The alreadyMember pre-check in AddAsync is a fast path, not the real duplicate-prevention
        // mechanism - two genuinely concurrent Add calls (separate DbContexts/connections, launched
        // without awaiting either first, so their DB round trips can truly interleave on the wire)
        // must still leave exactly one CollectionItem row, with neither call throwing. Whichever
        // request's pre-check races ahead, the real guarantee is the database's own
        // UX_CollectionItems_CollectionId_ItemId unique index plus AddAsync's catch around the
        // insert - this assertion holds regardless of how the two connections actually interleave.
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-concurrent-add");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var dbContextA = new JupleDbContext(options);
        await using var dbContextB = new JupleDbContext(options);
        var storeA = new CollectionStore(dbContextA);
        var storeB = new CollectionStore(dbContextB);

        var addedAtUtc = DateTimeOffset.UtcNow;
        var taskA = storeA.AddAsync(_userId, collectionId, itemId, addedAtUtc);
        var taskB = storeB.AddAsync(_userId, collectionId, itemId, addedAtUtc);

        // Neither call may throw - both must complete as idempotent success even under a genuine race.
        await Task.WhenAll(taskA, taskB);

        var rowCount = await _dbContext.CollectionItems
            .AsNoTracking()
            .CountAsync(membership => membership.CollectionId == collectionId && membership.ItemId == itemId);
        Assert.Equal(1, rowCount);
    }

    [Fact]
    public async Task AddAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-no-collection");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.AddAsync(_userId, collectionId: -1, itemId, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task AddAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var theirCollection = await CreateCollectionAsync(store, _otherUserId, "TheirsOnly");
        var myItem = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-foreign-collection");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.AddAsync(_userId, theirCollection, myItem, DateTimeOffset.UtcNow));

        var (page, _, _) = await store.GetItemsAsync(_otherUserId, theirCollection, cursor: null, limit: 50);
        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task AddAsync_WhenItemDoesNotExist_ThrowsItemNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.AddAsync(_userId, collectionId, itemId: -1, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task AddAsync_WithOtherUsersItem_ThrowsItemNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var theirItem = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/coll-foreign-item");

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.AddAsync(_userId, collectionId, theirItem, DateTimeOffset.UtcNow));

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task RemoveAsync_RemovesMembershipButKeepsItem()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-remove");
        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.RemoveAsync(_userId, collectionId, itemId);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Empty(page.Items);

        var itemStillExists = await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == itemId);
        Assert.True(itemStillExists);
    }

    [Fact]
    public async Task RemoveAsync_WhenNotAMember_CompletesWithoutException()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-remove-nonmember");

        await store.RemoveAsync(_userId, collectionId, itemId);
    }

    [Fact]
    public async Task RemoveAsync_OnOtherUsersCollection_DoesNotRemoveAndCompletesWithoutException()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var theirCollection = await CreateCollectionAsync(store, _otherUserId, "TheirsOnly");
        var theirItem = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/coll-cross-remove");
        await store.AddAsync(_otherUserId, theirCollection, theirItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.RemoveAsync(_userId, theirCollection, theirItem);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_otherUserId, theirCollection, cursor: null, limit: 50);
        Assert.Single(page.Items);
    }

    [Fact]
    public async Task DeleteCollection_DoesNotDeleteItems()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-delete-collection");
        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, collectionId);
        _dbContext.ChangeTracker.Clear();

        var itemStillExists = await _dbContext.Items.AsNoTracking().AnyAsync(item => item.Id == itemId);
        Assert.True(itemStillExists);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.GetAsync(_userId, collectionId));
    }

    [Fact]
    public async Task DeleteItem_CleansMembershipButKeepsCollection()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-delete-item");
        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await itemStore.DeleteAsync(_userId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Empty(page.Items);

        var collection = await store.GetAsync(_userId, collectionId);
        Assert.Equal(0, collection.ItemCount);
    }

    [Fact]
    public async Task RestoreItem_MembershipReappearsInListAndCount()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-restore-item");
        await store.AddAsync(_userId, collectionId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await itemStore.DeleteAsync(_userId, itemId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await itemStore.RestoreAsync(_userId, itemId);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);
        Assert.Contains(page.Items, item => item.ItemId == itemId);

        var collection = await store.GetAsync(_userId, collectionId);
        Assert.Equal(1, collection.ItemCount);
    }

    [Fact]
    public async Task GetItemsAsync_OrdersBySortOrderAscending_NewestAddedFirstByDefault()
    {
        // Each Add prepends (see CollectionStore.AddAsync), so with no manual reorder the default
        // order still matches the old AddedAtUtc-DESC/ItemId-DESC behavior exactly.
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var baseTime = DateTimeOffset.UtcNow;

        var first = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-order-1");
        var second = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-order-2");
        var third = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-order-3");

        await store.AddAsync(_userId, collectionId, first, baseTime);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, second, baseTime.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, third, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 50);

        Assert.Equal([third, second, first], page.Items.Select(item => item.ItemId));
    }

    [Fact]
    public async Task GetItemsAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var itemId = await CreateItemAsync(itemStore, _userId, $"https://shop.example/coll-page-{i}");
            await store.AddAsync(_userId, collectionId, itemId, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            ids.Add(itemId);
        }

        var (firstPage, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _, _) = await store.GetItemsAsync(_userId, collectionId, firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var (thirdPage, _, _) = await store.GetItemsAsync(_userId, collectionId, secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(item => item.ItemId)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetItemsAsync_WhenAddedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var itemId = await CreateItemAsync(itemStore, _userId, $"https://shop.example/coll-tie-{i}");
            await store.AddAsync(_userId, collectionId, itemId, sameTime);
            _dbContext.ChangeTracker.Clear();
            ids.Add(itemId);
        }

        var (firstPage, _, _) = await store.GetItemsAsync(_userId, collectionId, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var (secondPage, _, _) = await store.GetItemsAsync(_userId, collectionId, firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(item => item.ItemId).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task GetItemsAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.GetItemsAsync(_userId, collectionId: -1, cursor: null, limit: 50));
    }

    [Fact]
    public async Task GetItemsAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var theirCollection = await CreateCollectionAsync(store, _otherUserId, "TheirsOnly");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.GetItemsAsync(_userId, theirCollection, cursor: null, limit: 50));
    }

    [Fact]
    public async Task ListAsync_WithItemIdFilter_ReturnsOnlyCollectionsContainingThatItem()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionA = await CreateCollectionAsync(store, _userId, "Books");
        var collectionB = await CreateCollectionAsync(store, _userId, "Recipes");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-filter");
        await store.AddAsync(_userId, collectionA, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var filtered = await store.ListAsync(_userId, item, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Single(filtered.Items);
        Assert.Equal(collectionA, filtered.Items[0].Id);
        Assert.DoesNotContain(filtered.Items, c => c.Id == collectionB);
    }

    [Fact]
    public async Task ListAsync_WithItemIdFilter_ForNonExistentItem_ReturnsEmpty()
    {
        var store = new CollectionStore(_dbContext);
        await CreateCollectionAsync(store, _userId, "Books");

        var filtered = await store.ListAsync(_userId, itemId: -1, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Empty(filtered.Items);
    }

    [Fact]
    public async Task ListAsync_WithItemIdFilter_ComposesWithPagination()
    {
        // The itemId filter and cursor pagination must apply together, not as two separate
        // contracts - a filtered result set still pages correctly.
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-filter-page");
        var baseTime = DateTimeOffset.UtcNow;
        var containingIds = new List<long>();
        for (var i = 0; i < 3; i++)
        {
            var collectionId = await CreateCollectionAsync(store, _userId, $"Filtered {i}");
            await store.AddAsync(_userId, collectionId, item, baseTime);
            _dbContext.ChangeTracker.Clear();
            containingIds.Add(collectionId);
        }
        // A distractor Collection that does NOT contain the Item - must never appear in the
        // filtered+paginated result no matter how pages are walked.
        await CreateCollectionAsync(store, _userId, "Unrelated");

        var firstPage = await store.ListAsync(_userId, item, excludeItemId: null, isFavorite: null, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(
            _userId, item, excludeItemId: null, isFavorite: null, cursor: firstPage.NextCursor, limit: 2);
        Assert.Single(secondPage.Items);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(c => c.Id).ToList();
        Assert.Equal(3, allReturnedIds.Distinct().Count());
        Assert.Equal(containingIds.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task ListAsync_WithExcludeItemIdFilter_ExcludesCollectionAlreadyContainingThatItem()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var containing = await CreateCollectionAsync(store, _userId, "Already In");
        var notContaining = await CreateCollectionAsync(store, _userId, "Not In");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-exclude");
        await store.AddAsync(_userId, containing, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, itemId: null, item, isFavorite: null, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(notContaining, page.Items[0].Id);
        Assert.DoesNotContain(page.Items, c => c.Id == containing);
    }

    [Fact]
    public async Task ListAsync_WithExcludeItemIdFilter_ForNonExistentItem_ExcludesNothing()
    {
        var store = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: -1, isFavorite: null, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(collectionId, page.Items[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithExcludeItemIdFilter_ComposesWithPaginationWithoutDuplicateOrMissing()
    {
        // A Collection the Item already belongs to must never resurface as an "add to collection"
        // candidate on any page - even after paging through several addable Collections.
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/coll-exclude-page");
        var baseTime = DateTimeOffset.UtcNow;

        var alreadyContaining = await CreateCollectionAsync(store, _userId, "Already In");
        await store.AddAsync(_userId, alreadyContaining, item, baseTime);
        _dbContext.ChangeTracker.Clear();

        var addableIds = new List<long>();
        for (var i = 0; i < 3; i++)
        {
            var collectionId = await CreateCollectionAsync(store, _userId, $"Addable {i}");
            addableIds.Add(collectionId);
        }

        var firstPage = await store.ListAsync(_userId, itemId: null, item, isFavorite: null, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);
        Assert.DoesNotContain(firstPage.Items, c => c.Id == alreadyContaining);

        var secondPage = await store.ListAsync(
            _userId, itemId: null, item, isFavorite: null, cursor: firstPage.NextCursor, limit: 2);
        Assert.Single(secondPage.Items);
        Assert.Null(secondPage.NextCursor);
        Assert.DoesNotContain(secondPage.Items, c => c.Id == alreadyContaining);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(c => c.Id).ToList();
        Assert.Equal(3, allReturnedIds.Distinct().Count());
        Assert.Equal(addableIds.OrderByDescending(id => id), allReturnedIds);
    }

    private async Task<List<long>> GetOrderedItemIdsAsync(CollectionStore store, long userId, long collectionId)
    {
        var (page, _, _) = await store.GetItemsAsync(userId, collectionId, cursor: null, limit: 50);
        return page.Items.Select(item => item.ItemId).ToList();
    }

    [Fact]
    public async Task MoveItemAsync_ToFront_WhenAfterItemIdIsNull_PlacesItemFirst()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var a = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-front-a");
        var b = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-front-b");
        var c = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-front-c");
        await store.AddAsync(_userId, collectionId, a, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, b, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, c, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        // Default order (newest-first): [c, b, a].

        await store.MoveItemAsync(_userId, collectionId, a, afterItemId: null);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal([a, c, b], await GetOrderedItemIdsAsync(store, _userId, collectionId));
    }

    [Fact]
    public async Task MoveItemAsync_ToMiddle_PlacesItemImmediatelyAfterAnchor()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var a = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-mid-a");
        var b = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-mid-b");
        var c = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-mid-c");
        await store.AddAsync(_userId, collectionId, a, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, b, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, c, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        // Default order (newest-first): [c, b, a]. Move a to right after c: [c, a, b].

        await store.MoveItemAsync(_userId, collectionId, a, afterItemId: c);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal([c, a, b], await GetOrderedItemIdsAsync(store, _userId, collectionId));
    }

    [Fact]
    public async Task MoveItemAsync_ToEnd_WhenAfterItemIdIsTheLastItem_PlacesItemLast()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var a = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-end-a");
        var b = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-end-b");
        var c = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-end-c");
        await store.AddAsync(_userId, collectionId, a, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, b, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, c, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        // Default order (newest-first): [c, b, a]. Move c to right after (last item) a: [b, a, c].

        await store.MoveItemAsync(_userId, collectionId, c, afterItemId: a);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal([b, a, c], await GetOrderedItemIdsAsync(store, _userId, collectionId));
    }

    [Fact]
    public async Task MoveItemAsync_WhenNoIntegerGapRemainsBetweenNeighbors_RenumbersAndStillPlacesItemCorrectly()
    {
        // Directly manufactures an exhausted gap (SortOrder values 0 and 1, adjacent integers, no
        // room for a midpoint) so a single move between them must hit MoveItemAsync's self-healing
        // renumber path (see its needsRenumber branch) rather than computing a bad/duplicate value.
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var low = await CreateItemAsync(itemStore, _userId, "https://shop.example/renumber-low");
        var high = await CreateItemAsync(itemStore, _userId, "https://shop.example/renumber-high");
        var mover = await CreateItemAsync(itemStore, _userId, "https://shop.example/renumber-mover");
        await store.AddAsync(_userId, collectionId, low, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, high, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, mover, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.CollectionItems SET SortOrder = 0 WHERE CollectionId = {collectionId} AND ItemId = {low}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.CollectionItems SET SortOrder = 1 WHERE CollectionId = {collectionId} AND ItemId = {high}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.CollectionItems SET SortOrder = -1000 WHERE CollectionId = {collectionId} AND ItemId = {mover}");
        _dbContext.ChangeTracker.Clear();
        // [mover, low, high] with no integer room between low(0) and high(1).

        await store.MoveItemAsync(_userId, collectionId, mover, afterItemId: low);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal([low, mover, high], await GetOrderedItemIdsAsync(store, _userId, collectionId));

        // The renumber must leave every row with a distinct SortOrder, not just a correct read
        // order - a real duplicate would still coincidentally sort correctly today but leave no
        // room for a future move without an immediate second renumber.
        var sortOrders = await _dbContext.CollectionItems
            .AsNoTracking()
            .Where(item => item.CollectionId == collectionId)
            .Select(item => item.SortOrder)
            .ToListAsync();
        Assert.Equal(3, sortOrders.Distinct().Count());
    }

    [Fact]
    public async Task MoveItemAsync_MovingRightAfterItself_IsANoOp()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var a = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-self-a");
        var b = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-self-b");
        await store.AddAsync(_userId, collectionId, a, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collectionId, b, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var before = await GetOrderedItemIdsAsync(store, _userId, collectionId);

        await store.MoveItemAsync(_userId, collectionId, a, afterItemId: a);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal(before, await GetOrderedItemIdsAsync(store, _userId, collectionId));
    }

    [Fact]
    public async Task MoveItemAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var itemId = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-no-collection");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.MoveItemAsync(_userId, collectionId: -1, itemId, afterItemId: null));
    }

    [Fact]
    public async Task MoveItemAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var theirCollection = await CreateCollectionAsync(store, _otherUserId, "TheirsOnly");
        var theirItem = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/move-foreign-collection");
        await store.AddAsync(_otherUserId, theirCollection, theirItem, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.MoveItemAsync(_userId, theirCollection, theirItem, afterItemId: null));
    }

    [Fact]
    public async Task MoveItemAsync_WhenItemNotInCollection_ThrowsItemNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var outsideItem = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-not-member");

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.MoveItemAsync(_userId, collectionId, outsideItem, afterItemId: null));
    }

    [Fact]
    public async Task MoveItemAsync_WhenAfterItemIdNotInCollection_ThrowsItemNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collectionId = await CreateCollectionAsync(store, _userId, "Books");
        var a = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-bad-anchor-a");
        var outsideItem = await CreateItemAsync(itemStore, _userId, "https://shop.example/move-bad-anchor-outside");
        await store.AddAsync(_userId, collectionId, a, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.MoveItemAsync(_userId, collectionId, a, afterItemId: outsideItem));
    }

    [Fact]
    public async Task MoveItemAsync_OnlyOwnerCanReorder_OtherUsersItemInTheirOwnCollectionIsUnaffected()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var theirCollection = await CreateCollectionAsync(store, _otherUserId, "TheirsOnly");
        var theirA = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/move-owner-a");
        var theirB = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/move-owner-b");
        await store.AddAsync(_otherUserId, theirCollection, theirA, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_otherUserId, theirCollection, theirB, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var before = await GetOrderedItemIdsAsync(store, _otherUserId, theirCollection);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.MoveItemAsync(_userId, theirCollection, theirA, afterItemId: null));

        Assert.Equal(before, await GetOrderedItemIdsAsync(store, _otherUserId, theirCollection));
    }

    [Fact]
    public async Task TransferItemAsync_MovesOnlyTheSourceMembership_AndAvoidsTargetDuplicates()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Transfer source");
        var target = await CreateCollectionAsync(store, _userId, "Transfer target");
        var other = await CreateCollectionAsync(store, _userId, "Transfer other");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/transfer");
        await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, other, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var createdTargetResult = await store.TransferItemAsync(_userId, source, item, target);
        _dbContext.ChangeTracker.Clear();

        Assert.True(createdTargetResult.TargetMembershipCreated);
        Assert.False(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == source && x.ItemId == item));
        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == target && x.ItemId == item));
        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == other && x.ItemId == item));

        var alreadyInTarget = await CreateItemAsync(itemStore, _userId, "https://shop.example/transfer-existing-target");
        await store.AddAsync(_userId, source, alreadyInTarget, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, target, alreadyInTarget, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var existingTargetResult = await store.TransferItemAsync(_userId, source, alreadyInTarget, target);
        Assert.False(existingTargetResult.TargetMembershipCreated);
        Assert.False(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == source && x.ItemId == alreadyInTarget));
        Assert.Equal(1, await _dbContext.CollectionItems.CountAsync(
            x => x.CollectionId == target && x.ItemId == alreadyInTarget));
    }

    [Fact]
    public async Task TransferItemAsync_RejectsDeletedItem_WithoutChangingSourceMembership()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Deleted transfer source");
        var target = await CreateCollectionAsync(store, _userId, "Deleted transfer target");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/transfer-deleted");
        await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await itemStore.DeleteAsync(_userId, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.TransferItemAsync(_userId, source, item, target));

        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == source && x.ItemId == item));
        Assert.False(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == target && x.ItemId == item));
    }

    [Fact]
    public async Task UndoTransferItemAsync_WhenMoveCreatedTargetMembership_RestoresSourceOnly()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Undo source only");
        var target = await CreateCollectionAsync(store, _userId, "Undo target only");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-source-only");
        await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var move = await store.TransferItemAsync(_userId, source, item, target);
        await store.UndoTransferItemAsync(_userId, source, item, target, move.TargetMembershipCreated);
        _dbContext.ChangeTracker.Clear();

        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == source && x.ItemId == item));
        Assert.False(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == target && x.ItemId == item));
    }

    [Fact]
    public async Task UndoTransferItemAsync_WhenTargetAlreadyContainedItem_RestoresBothMemberships()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Undo source duplicate");
        var target = await CreateCollectionAsync(store, _userId, "Undo target duplicate");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-existing-target");
        await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, target, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var move = await store.TransferItemAsync(_userId, source, item, target);
        Assert.False(move.TargetMembershipCreated);
        await store.UndoTransferItemAsync(_userId, source, item, target, move.TargetMembershipCreated);
        _dbContext.ChangeTracker.Clear();

        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == source && x.ItemId == item));
        Assert.Equal(1, await _dbContext.CollectionItems.CountAsync(x => x.CollectionId == target && x.ItemId == item));
    }

    [Fact]
    public async Task UndoTransferItemAsync_WhenCalledTwice_DoesNotCreateDuplicateMemberships()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Undo idempotent source");
        var target = await CreateCollectionAsync(store, _userId, "Undo idempotent target");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-idempotent");
        await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var move = await store.TransferItemAsync(_userId, source, item, target);
        await store.UndoTransferItemAsync(_userId, source, item, target, move.TargetMembershipCreated);
        await store.UndoTransferItemAsync(_userId, source, item, target, move.TargetMembershipCreated);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal(1, await _dbContext.CollectionItems.CountAsync(x => x.CollectionId == source && x.ItemId == item));
        Assert.False(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == target && x.ItemId == item));
    }

    [Fact]
    public async Task UndoTransferItemAsync_WhenSourceEqualsTarget_IsANoOp()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collection = await CreateCollectionAsync(store, _userId, "Undo self");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-self");
        await store.AddAsync(_userId, collection, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UndoTransferItemAsync(_userId, collection, item, collection, targetMembershipCreated: true);
        _dbContext.ChangeTracker.Clear();

        Assert.Equal(1, await _dbContext.CollectionItems.CountAsync(x => x.CollectionId == collection && x.ItemId == item));
    }

    [Fact]
    public async Task UndoTransferItemAsync_RejectsForeignCollectionsAndItems()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Owned undo source");
        var target = await CreateCollectionAsync(store, _userId, "Owned undo target");
        var foreignCollection = await CreateCollectionAsync(store, _otherUserId, "Foreign undo collection");
        var ownedItem = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-owned-item");
        var foreignItem = await CreateItemAsync(itemStore, _otherUserId, "https://shop.example/undo-foreign-item");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.UndoTransferItemAsync(_userId, foreignCollection, ownedItem, target, false));
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.UndoTransferItemAsync(_userId, source, ownedItem, foreignCollection, false));
        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => store.UndoTransferItemAsync(_userId, source, foreignItem, target, false));
    }

    [Fact]
    public async Task MergeAsync_UnionsAllMemberships_IncludingDeletedItems_AndSoftDeletesSource()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Merge source");
        var target = await CreateCollectionAsync(store, _userId, "Merge target");
        var targetBefore = await store.GetAsync(_userId, target);
        var first = await CreateItemAsync(itemStore, _userId, "https://shop.example/merge-first");
        var duplicate = await CreateItemAsync(itemStore, _userId, "https://shop.example/merge-duplicate");
        var deleted = await CreateItemAsync(itemStore, _userId, "https://shop.example/merge-deleted");
        var targetOnly = await CreateItemAsync(itemStore, _userId, "https://shop.example/merge-target-only");
        foreach (var item in new[] { first, duplicate, deleted })
        {
            await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
        }
        foreach (var item in new[] { duplicate, targetOnly })
        {
            await store.AddAsync(_userId, target, item, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
        }
        await itemStore.DeleteAsync(_userId, deleted, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var deletedAtUtcBeforeMerge = await _dbContext.Items.AsNoTracking()
            .Where(x => x.Id == deleted).Select(x => x.DeletedAtUtc).SingleAsync();

        var result = await store.MergeAsync(_userId, source, target);
        _dbContext.ChangeTracker.Clear();

        // Soft-deleted, not hard-deleted - metadata and every source membership (including the
        // soft-deleted Item's) survive, and Undo has something to restore.
        Assert.NotNull(result.UndoOperationId);
        var sourceAfterMerge = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.NotNull(sourceAfterMerge.DeletedAtUtc);
        var sourceMembershipIds = await _dbContext.CollectionItems.AsNoTracking()
            .Where(x => x.CollectionId == source).Select(x => x.ItemId).ToListAsync();
        Assert.Equal(new[] { first, duplicate, deleted }.OrderBy(x => x), sourceMembershipIds.OrderBy(x => x));

        var targetAfter = await store.GetAsync(_userId, target);
        Assert.Equal(targetBefore.Name, targetAfter.Name);
        Assert.Equal(targetBefore.IsFavorite, targetAfter.IsFavorite);
        Assert.Equal(targetBefore.Icon, targetAfter.Icon);
        Assert.Equal(targetBefore.Color, targetAfter.Color);
        var targetIds = await _dbContext.CollectionItems.Where(x => x.CollectionId == target)
            .Select(x => x.ItemId).ToListAsync();
        Assert.Equal(4, targetIds.Distinct().Count());
        Assert.Contains(deleted, targetIds);

        // Merge/Undo never touches the Item itself, only CollectionItem membership rows.
        var deletedAtUtcAfterMerge = await _dbContext.Items.AsNoTracking()
            .Where(x => x.Id == deleted).Select(x => x.DeletedAtUtc).SingleAsync();
        Assert.Equal(deletedAtUtcBeforeMerge, deletedAtUtcAfterMerge);

        await itemStore.RestoreAsync(_userId, deleted);
        _dbContext.ChangeTracker.Clear();
        var (page, _, _) = await store.GetItemsAsync(_userId, target, null, 50);
        Assert.Contains(page.Items, x => x.ItemId == deleted);
    }

    [Fact]
    public async Task MergeAsync_RejectsOtherUsersTarget_WithoutDeletingSource()
    {
        var store = new CollectionStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Owned merge source");
        var target = await CreateCollectionAsync(store, _otherUserId, "Foreign merge target");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.MergeAsync(_userId, source, target));

        var sourceAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.Null(sourceAfter.DeletedAtUtc);
    }

    [Fact]
    public async Task MergeAsync_WhenSourceEqualsTarget_IsANoOp()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var collection = await CreateCollectionAsync(store, _userId, "Self merge");
        var item = await CreateItemAsync(itemStore, _userId, "https://shop.example/self-merge");
        await store.AddAsync(_userId, collection, item, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.MergeAsync(_userId, collection, collection);
        _dbContext.ChangeTracker.Clear();

        Assert.Null(result.UndoOperationId);
        var collectionAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == collection);
        Assert.Null(collectionAfter.DeletedAtUtc);
        Assert.True(await _dbContext.CollectionItems.AnyAsync(x => x.CollectionId == collection && x.ItemId == item));
    }

    /// <summary>
    /// The task spec's own canonical example: Source has Item1/2/3, Target already has Item2/4.
    /// Shared by every UndoMergeAsync test below that needs this exact starting shape.
    /// </summary>
    private async Task<(CollectionStore Store, long Source, long Target, long FirstItem, long SecondItem, long ThirdItem, long FourthItem, Guid UndoOperationId)>
        MergeCanonicalExampleAsync()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new ItemStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Undo source");
        var target = await CreateCollectionAsync(store, _userId, "Undo target");
        var item1 = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-item1");
        var item2 = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-item2");
        var item3 = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-item3");
        var item4 = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-item4");
        foreach (var item in new[] { item1, item2, item3 })
        {
            await store.AddAsync(_userId, source, item, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
        }
        foreach (var item in new[] { item2, item4 })
        {
            await store.AddAsync(_userId, target, item, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
        }

        var result = await store.MergeAsync(_userId, source, target);
        _dbContext.ChangeTracker.Clear();
        Assert.NotNull(result.UndoOperationId);

        return (store, source, target, item1, item2, item3, item4, result.UndoOperationId.Value);
    }

    private async Task<List<long>> GetMembershipItemIdsAsync(long collectionId) =>
        await _dbContext.CollectionItems.AsNoTracking()
            .Where(x => x.CollectionId == collectionId).Select(x => x.ItemId).ToListAsync();

    [Fact]
    public async Task UndoMergeAsync_RestoresSourceAndRemovesOnlyMergeCreatedTargetMemberships()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        var sourceAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.Null(sourceAfter.DeletedAtUtc);
        var sourceItems = await GetMembershipItemIdsAsync(source);
        Assert.Equal(new[] { item1, item2, item3 }.OrderBy(x => x), sourceItems.OrderBy(x => x));
        var targetItems = await GetMembershipItemIdsAsync(target);
        Assert.Equal(new[] { item2, item4 }.OrderBy(x => x), targetItems.OrderBy(x => x));
    }

    [Fact]
    public async Task UndoMergeAsync_PreservesExactPreexistingTargetMembershipRow()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();
        var preexistingRowId = await _dbContext.CollectionItems.AsNoTracking()
            .Where(x => x.CollectionId == target && x.ItemId == item2).Select(x => x.Id).SingleAsync();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        // Same row, not "removed by Undo and coincidentally still absent" - Undo must never have
        // touched Item2's Target membership at all, since it predates the merge.
        var rowIdAfterUndo = await _dbContext.CollectionItems.AsNoTracking()
            .Where(x => x.CollectionId == target && x.ItemId == item2).Select(x => x.Id).SingleAsync();
        Assert.Equal(preexistingRowId, rowIdAfterUndo);
    }

    [Fact]
    public async Task UndoMergeAsync_PreservesUnrelatedMembershipAddedAfterMerge()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();
        var itemStore = new ItemStore(_dbContext);
        var item5 = await CreateItemAsync(itemStore, _userId, "https://shop.example/undo-item5");
        await store.AddAsync(_userId, target, item5, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        var targetItems = await GetMembershipItemIdsAsync(target);
        Assert.Equal(new[] { item2, item4, item5 }.OrderBy(x => x), targetItems.OrderBy(x => x));
    }

    [Fact]
    public async Task UndoMergeAsync_PreservesMembershipRemovedThenDirectlyReAddedAfterMerge()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();

        // Item1's Target membership was created by the merge - unlink it, then the user directly
        // re-adds it themselves. The re-added row gets a brand new Id (see
        // CollectionMergeCreatedMembership's own remarks), so Undo must leave it alone.
        await store.RemoveAsync(_userId, target, item1);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, target, item1, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        var targetItems = await GetMembershipItemIdsAsync(target);
        // Item1 (re-added directly) and Item2/4 (preexisting) survive; only Item3 (merge-created,
        // never touched afterward) is removed by Undo.
        Assert.Equal(new[] { item1, item2, item4 }.OrderBy(x => x), targetItems.OrderBy(x => x));
    }

    [Fact]
    public async Task UndoMergeAsync_WhenTargetIsSoftDeleted_LeavesTargetDeletedButStillCleansUpMemberships()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();

        await store.DeleteAsync(_userId, target);
        _dbContext.ChangeTracker.Clear();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        var sourceAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.Null(sourceAfter.DeletedAtUtc);
        // Target itself is never restored by a Merge Undo - only the memberships it created.
        var targetAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == target);
        Assert.NotNull(targetAfter.DeletedAtUtc);
        var targetItems = await GetMembershipItemIdsAsync(target);
        Assert.Equal(new[] { item2, item4 }.OrderBy(x => x), targetItems.OrderBy(x => x));
    }

    [Fact]
    public async Task UndoMergeAsync_RestoresPublicShareAvailability_WithoutMintingANewPublicId()
    {
        var store = new CollectionStore(_dbContext);
        var shareStore = new CollectionShareStore(_dbContext);
        var publicStore = new PublicCollectionStore(_dbContext);
        var source = await CreateCollectionAsync(store, _userId, "Shared merge source");
        var target = await CreateCollectionAsync(store, _userId, "Shared merge target");
        var share = await shareStore.EnableAsync(_userId, source, "merge-share-public-id", DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.MergeAsync(_userId, source, target);
        _dbContext.ChangeTracker.Clear();

        // Source soft-deleted by the merge - the existing public URL stops resolving.
        Assert.Null(await publicStore.GetCollectionAsync(share.PublicId));

        await store.UndoMergeAsync(_userId, result.UndoOperationId!.Value);
        _dbContext.ChangeTracker.Clear();

        // Same PublicId resolves again - never a freshly minted share.
        var publicCollection = await publicStore.GetCollectionAsync(share.PublicId);
        Assert.NotNull(publicCollection);
        var activeShare = await shareStore.GetActiveAsync(_userId, source);
        Assert.Equal(share.PublicId, activeShare?.PublicId);
    }

    [Fact]
    public async Task UndoMergeAsync_RejectsOtherUsersOperation_LeavingAllMergeStateUnchanged()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.UndoMergeAsync(_otherUserId, undoOperationId));
        _dbContext.ChangeTracker.Clear();

        // Representative transaction-rollback check: a rejected Undo must leave every piece of
        // state it would have touched exactly as it was, not just the first one checked.
        var sourceAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.NotNull(sourceAfter.DeletedAtUtc);
        var targetItems = await GetMembershipItemIdsAsync(target);
        Assert.Equal(new[] { item1, item2, item3, item4 }.OrderBy(x => x), targetItems.OrderBy(x => x));
        var operationAfter = await _dbContext.CollectionMergeOperations.AsNoTracking()
            .SingleAsync(x => x.OperationToken == undoOperationId);
        Assert.Null(operationAfter.UndoneAtUtc);
    }

    [Fact]
    public async Task UndoMergeAsync_CalledTwice_IsIdempotent()
    {
        var (store, source, target, item1, item2, item3, item4, undoOperationId) = await MergeCanonicalExampleAsync();

        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();
        var targetItemsAfterFirstUndo = await GetMembershipItemIdsAsync(target);

        // A retried request (e.g. a client timeout/retry) must never re-restore or re-clean-up.
        await store.UndoMergeAsync(_userId, undoOperationId);
        _dbContext.ChangeTracker.Clear();

        var sourceAfter = await _dbContext.Collections.AsNoTracking().SingleAsync(x => x.Id == source);
        Assert.Null(sourceAfter.DeletedAtUtc);
        var targetItemsAfterSecondUndo = await GetMembershipItemIdsAsync(target);
        Assert.Equal(targetItemsAfterFirstUndo.OrderBy(x => x), targetItemsAfterSecondUndo.OrderBy(x => x));
    }
}
