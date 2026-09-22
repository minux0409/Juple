using Juple.Application.Collections;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

public sealed class CollectionIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run collection integration tests " +
                "against a local SQL Server instance.");

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

    private static (string Name, string NameNormalized) Normalize(string name) =>
        (name, name.ToUpperInvariant());

    [Fact]
    public async Task SoftDeleteAndRestore_PreservesRowsMetadataAndMembership()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new Juple.Infrastructure.Items.ItemStore(_dbContext);
        var (name, normalized) = Normalize("Soft-delete collection");
        var collection = await store.CreateAsync(_userId, name, normalized, CollectionIcon.Plane, DateTimeOffset.UtcNow, CollectionColor.Mint);
        var item = await itemStore.SaveAsync(_userId, "https://example.test/soft-delete", null, DateTimeOffset.UtcNow);
        await store.AddAsync(_userId, collection.Id, item.Entry.Id, DateTimeOffset.UtcNow);
        await store.SetFavoriteAsync(_userId, collection.Id, true, DateTimeOffset.UtcNow);

        await store.DeleteAsync(_userId, collection.Id);
        _dbContext.ChangeTracker.Clear();

        var deleted = await _dbContext.Collections.SingleAsync(c => c.Id == collection.Id);
        Assert.NotNull(deleted.DeletedAtUtc);
        Assert.True(await _dbContext.CollectionItems.AnyAsync(m => m.CollectionId == collection.Id && m.ItemId == item.Entry.Id));
        Assert.True(await _dbContext.Items.AnyAsync(i => i.Id == item.Entry.Id));
        Assert.Empty((await store.ListAsync(_userId, null, null, null, null, 50)).Items);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.GetAsync(_userId, collection.Id));

        await store.RestoreAsync(_userId, collection.Id);
        _dbContext.ChangeTracker.Clear();

        var restored = await store.GetAsync(_userId, collection.Id);
        Assert.Equal(name, restored.Name);
        Assert.Equal("Plane", restored.Icon);
        Assert.Equal("Mint", restored.Color);
        Assert.True(restored.IsFavorite);
        Assert.Single((await store.GetItemsAsync(_userId, collection.Id, null, 50)).Page.Items);
    }

    [Fact]
    public async Task DeletedCollection_RejectsAddAndMoveOrMergeTargets()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new Juple.Infrastructure.Items.ItemStore(_dbContext);
        var source = await store.CreateAsync(_userId, "Source", "SOURCE", CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var deletedTarget = await store.CreateAsync(_userId, "Deleted target", "DELETED TARGET", CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var item = await itemStore.SaveAsync(_userId, "https://example.test/deleted-target", null, DateTimeOffset.UtcNow);
        await store.AddAsync(_userId, source.Id, item.Entry.Id, DateTimeOffset.UtcNow);
        await store.DeleteAsync(_userId, deletedTarget.Id);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.AddAsync(_userId, deletedTarget.Id, item.Entry.Id, DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.TransferItemAsync(_userId, source.Id, item.Entry.Id, deletedTarget.Id));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.MergeAsync(_userId, source.Id, deletedTarget.Id));
    }

    [Fact]
    public async Task CollectionRestore_DoesNotChangeSoftDeletedItemAndPreservesItsMembership()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new Juple.Infrastructure.Items.ItemStore(_dbContext);
        var collection = await store.CreateAsync(_userId, "Item independence", "ITEM INDEPENDENCE", CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var item = await itemStore.SaveAsync(_userId, "https://example.test/item-independence", null, DateTimeOffset.UtcNow);
        await store.AddAsync(_userId, collection.Id, item.Entry.Id, DateTimeOffset.UtcNow);
        await itemStore.DeleteAsync(_userId, item.Entry.Id, DateTimeOffset.UtcNow);
        await store.DeleteAsync(_userId, collection.Id);
        await store.RestoreAsync(_userId, collection.Id);
        _dbContext.ChangeTracker.Clear();

        Assert.NotNull((await _dbContext.Items.SingleAsync(i => i.Id == item.Entry.Id)).DeletedAtUtc);
        Assert.True(await _dbContext.CollectionItems.AnyAsync(m => m.CollectionId == collection.Id && m.ItemId == item.Entry.Id));
        Assert.Empty((await store.GetItemsAsync(_userId, collection.Id, null, 50)).Page.Items);

        await itemStore.RestoreAsync(_userId, item.Entry.Id);
        _dbContext.ChangeTracker.Clear();
        Assert.Single((await store.GetItemsAsync(_userId, collection.Id, null, 50)).Page.Items);
    }

    [Fact]
    public async Task CreateAsync_PersistsCollectionWithZeroItemCount()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var now = DateTimeOffset.UtcNow;

        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, now);

        Assert.Equal("Books to read", created.Name);
        Assert.Equal(0, created.ItemCount);
        Assert.Equal(now, created.CreatedAtUtc);
        Assert.Equal(now, created.UpdatedAtUtc);
    }

    [Fact]
    public async Task ListAsync_ReturnsOrderedByCreatedAtUtcDescendingThenIdDescending()
    {
        var store = new CollectionStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var (nameA, normalizedA) = Normalize("Books");
        var (nameB, normalizedB) = Normalize("Electronics");
        var (nameC, normalizedC) = Normalize("Recipes");
        await store.CreateAsync(_userId, nameA, normalizedA, CollectionIcon.Folder, baseTime);
        await store.CreateAsync(_userId, nameB, normalizedB, CollectionIcon.Folder, baseTime.AddMinutes(1));
        await store.CreateAsync(_userId, nameC, normalizedC, CollectionIcon.Folder, baseTime.AddMinutes(2));

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Equal(["Recipes", "Electronics", "Books"], page.Items.Select(c => c.Name));
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersCollections()
    {
        var store = new CollectionStore(_dbContext);
        var (mineName, mineNormalized) = Normalize("Mine");
        var (theirsName, theirsNormalized) = Normalize("TheirsOnly");
        await store.CreateAsync(_userId, mineName, mineNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        await store.CreateAsync(_otherUserId, theirsName, theirsNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal("Mine", page.Items[0].Name);
    }

    [Fact]
    public async Task ListAsync_ReflectsItemCount()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new Juple.Infrastructure.Items.ItemStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books");
        var collection = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var itemA = await itemStore.SaveAsync(_userId, "https://shop.example/coll-count-a", null, DateTimeOffset.UtcNow);
        var itemB = await itemStore.SaveAsync(_userId, "https://shop.example/coll-count-b", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collection.Id, itemA.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, collection.Id, itemB.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Equal(2, Assert.Single(page.Items).ItemCount);
    }

    [Fact]
    public async Task ListAsync_LimitLessThanTotal_PagesWithoutDuplicateOrMissing()
    {
        var store = new CollectionStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var (name, nameNormalized) = Normalize($"Collection {i}");
            var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, baseTime.AddMinutes(i));
            ids.Add(created.Id);
        }

        var firstPage = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(
            _userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.ListAsync(
            _userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(c => c.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task ListAsync_WhenCreatedAtUtcTies_PagesWithoutDuplicateOrMissing()
    {
        var store = new CollectionStore(_dbContext);
        var sameTime = DateTimeOffset.UtcNow;
        var ids = new List<long>();
        for (var i = 0; i < 4; i++)
        {
            var (name, nameNormalized) = Normalize($"Tie {i}");
            var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, sameTime);
            ids.Add(created.Id);
        }

        var firstPage = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(
            _userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.Null(secondPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Select(c => c.Id).ToList();
        Assert.Equal(4, allReturnedIds.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task CreateAsync_WhenNameAlreadyExistsForSameUser_ThrowsCollectionNameConflict()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_WhenNameDiffersOnlyByCase_ThrowsCollectionNameConflict()
    {
        // Verifies NameNormalized (app-level culture-invariant uppercase), not the database's
        // default collation, is what makes "Gift Ideas" and "gift ideas" collide - unlike
        // Category's UX_Categories_UserId_Name index, which relies on collation for this.
        var store = new CollectionStore(_dbContext);
        var (firstName, firstNormalized) = Normalize("Gift Ideas");
        await store.CreateAsync(_userId, firstName, firstNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (secondName, secondNormalized) = Normalize("gift ideas");
        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => store.CreateAsync(_userId, secondName, secondNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_WhenSameNameUsedByDifferentUser_Succeeds()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        await store.CreateAsync(_otherUserId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);

        Assert.Equal("Books to read", created.Name);
    }

    [Fact]
    public async Task GetAsync_ReturnsCollectionWithItemCount()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var fetched = await store.GetAsync(_userId, created.Id);

        Assert.Equal("Books to read", fetched.Name);
        Assert.Equal(0, fetched.ItemCount);
    }

    [Fact]
    public async Task GetAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.GetAsync(_userId, collectionId: -1));
    }

    [Fact]
    public async Task GetAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("TheirsOnly");
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.GetAsync(_userId, theirs.Id));
    }

    [Fact]
    public async Task RenameAsync_PersistsNewNameAndUpdatedAtUtc()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var renamedAt = DateTimeOffset.UtcNow.AddMinutes(5);
        var (newName, newNormalized) = Normalize("Reading list");
        await store.RenameAsync(_userId, created.Id, newName, newNormalized, renamedAt);
        _dbContext.ChangeTracker.Clear();

        var fetched = await store.GetAsync(_userId, created.Id);
        Assert.Equal("Reading list", fetched.Name);
        Assert.Equal(renamedAt, fetched.UpdatedAtUtc);
    }

    [Fact]
    public async Task RenameAsync_ToAnotherOwnCollectionsName_ThrowsCollectionNameConflict()
    {
        var store = new CollectionStore(_dbContext);
        var (firstName, firstNormalized) = Normalize("Books to read");
        var (secondName, secondNormalized) = Normalize("Electronics");
        await store.CreateAsync(_userId, firstName, firstNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var second = await store.CreateAsync(_userId, secondName, secondNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => store.RenameAsync(_userId, second.Id, firstName, firstNormalized, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task RenameAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Reading list");

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.RenameAsync(_userId, collectionId: -1, name, nameNormalized, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task RenameAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Groceries");
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (attackName, attackNormalized) = Normalize("Attacker");
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.RenameAsync(_userId, theirs.Id, attackName, attackNormalized, DateTimeOffset.UtcNow));

        var stillTheirs = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.Equal("Groceries", stillTheirs.Name);
    }

    [Fact]
    public async Task DeleteAsync_RemovesCollection()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, created.Id);

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);
        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task DeleteAsync_WhenCollectionDoesNotExist_CompletesWithoutException()
    {
        var store = new CollectionStore(_dbContext);

        await store.DeleteAsync(_userId, collectionId: -1);
    }

    [Fact]
    public async Task DeleteAsync_OnOtherUsersCollection_DoesNotDeleteAndCompletesWithoutException()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Groceries");
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, theirs.Id);

        var stillOwnedPage = await store.ListAsync(
            _otherUserId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);
        Assert.Single(stillOwnedPage.Items);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SecondCallCompletesWithoutException()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, created.Id);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, created.Id);
    }

    [Fact]
    public async Task RenameAsync_WhenConcurrentWriteConflicts_ThrowsCollectionConcurrency()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherStore = new CollectionStore(otherDbContext);

        // Pre-load into otherDbContext before the concurrent rename below commits, so its tracked
        // RowVersion is stale by the time otherStore.RenameAsync's own internal query returns this
        // same tracked instance instead of a fresh (already-renamed) read.
        await otherDbContext.Collections.FirstAsync(c => c.Id == created.Id);

        var concurrentLoad = await _dbContext.Collections.FirstAsync(c => c.Id == created.Id);
        var (concurrentName, concurrentNormalized) = Normalize("Reading list");
        concurrentLoad.Rename(concurrentName, concurrentNormalized, DateTimeOffset.UtcNow);
        await _dbContext.SaveChangesAsync();

        var (raceName, raceNormalized) = Normalize("Wishlist ideas");
        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => otherStore.RenameAsync(_userId, created.Id, raceName, raceNormalized, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_DefaultsIsFavoriteToFalse()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");

        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);

        Assert.False(created.IsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_PersistsIsFavoriteAndUpdatesUpdatedAtUtc()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var favoritedAt = DateTimeOffset.UtcNow.AddMinutes(5);
        var result = await store.SetFavoriteAsync(_userId, created.Id, true, favoritedAt);

        Assert.True(result.IsFavorite);
        Assert.Equal(favoritedAt, result.UpdatedAtUtc);

        _dbContext.ChangeTracker.Clear();
        var fetched = await store.GetAsync(_userId, created.Id);
        Assert.True(fetched.IsFavorite);
        Assert.Equal(favoritedAt, fetched.UpdatedAtUtc);
    }

    [Fact]
    public async Task SetFavoriteAsync_ToFalse_PersistsChange()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.SetFavoriteAsync(_userId, created.Id, true, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var result = await store.SetFavoriteAsync(_userId, created.Id, false, DateTimeOffset.UtcNow);

        Assert.False(result.IsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_WhenCollectionDoesNotExist_ThrowsCollectionNotFound()
    {
        var store = new CollectionStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.SetFavoriteAsync(_userId, collectionId: -1, true, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task SetFavoriteAsync_OnOtherUsersCollection_ThrowsCollectionNotFoundAndDoesNotChangeIt()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Groceries");
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => store.SetFavoriteAsync(_userId, theirs.Id, true, DateTimeOffset.UtcNow));

        var stillTheirs = await store.GetAsync(_otherUserId, theirs.Id);
        Assert.False(stillTheirs.IsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_WhenConcurrentWriteConflicts_ThrowsCollectionConcurrency()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherStore = new CollectionStore(otherDbContext);

        // Same staleness setup as RenameAsync's concurrency test above.
        await otherDbContext.Collections.FirstAsync(c => c.Id == created.Id);

        var concurrentLoad = await _dbContext.Collections.FirstAsync(c => c.Id == created.Id);
        concurrentLoad.SetFavorite(true, DateTimeOffset.UtcNow);
        await _dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => otherStore.SetFavoriteAsync(_userId, created.Id, true, DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// A Rename and a SetFavorite racing on the same Collection must not silently overwrite each
    /// other's field - whichever save lands second sees a stale RowVersion and gets 409, rather
    /// than blindly persisting its own view of the row (which would otherwise revert the other
    /// request's change).
    /// </summary>
    [Fact]
    public async Task RenameAndSetFavorite_WhenRacingOnSameCollection_SecondSaveThrowsCollectionConcurrency()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherStore = new CollectionStore(otherDbContext);

        await otherDbContext.Collections.FirstAsync(c => c.Id == created.Id);

        var concurrentLoad = await _dbContext.Collections.FirstAsync(c => c.Id == created.Id);
        var (renamedName, renamedNormalized) = Normalize("Reading list");
        concurrentLoad.Rename(renamedName, renamedNormalized, DateTimeOffset.UtcNow);
        await _dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => otherStore.SetFavoriteAsync(_userId, created.Id, true, DateTimeOffset.UtcNow));

        _dbContext.ChangeTracker.Clear();
        var stillRenamed = await store.GetAsync(_userId, created.Id);
        Assert.Equal("Reading list", stillRenamed.Name);
        Assert.False(stillRenamed.IsFavorite);
    }

    [Fact]
    public async Task ListAsync_WithIsFavoriteTrueFilter_ReturnsOnlyFavorites()
    {
        var store = new CollectionStore(_dbContext);
        var (favoriteName, favoriteNormalized) = Normalize("Favorite one");
        var (otherName, otherNormalized) = Normalize("Not a favorite");
        var favorite = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        await store.CreateAsync(_userId, otherName, otherNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.SetFavoriteAsync(_userId, favorite.Id, true, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: true, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(favorite.Id, page.Items[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithIsFavoriteFalseFilter_ExcludesFavorites()
    {
        var store = new CollectionStore(_dbContext);
        var (favoriteName, favoriteNormalized) = Normalize("Favorite one");
        var (otherName, otherNormalized) = Normalize("Not a favorite");
        var favorite = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var other = await store.CreateAsync(_userId, otherName, otherNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.SetFavoriteAsync(_userId, favorite.Id, true, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: false, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(other.Id, page.Items[0].Id);
    }

    [Fact]
    public async Task ListAsync_WithIsFavoriteFilter_ComposesWithItemIdFilter()
    {
        var store = new CollectionStore(_dbContext);
        var itemStore = new Juple.Infrastructure.Items.ItemStore(_dbContext);
        var (favoriteName, favoriteNormalized) = Normalize("Favorite with item");
        var (otherFavoriteName, otherFavoriteNormalized) = Normalize("Favorite without item");
        var favoriteWithItem = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var favoriteWithoutItem = await store.CreateAsync(_userId, otherFavoriteName, otherFavoriteNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var item = await itemStore.SaveAsync(_userId, "https://shop.example/coll-favorite-itemid", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.AddAsync(_userId, favoriteWithItem.Id, item.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.SetFavoriteAsync(_userId, favoriteWithItem.Id, true, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.SetFavoriteAsync(_userId, favoriteWithoutItem.Id, true, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var page = await store.ListAsync(
            _userId, itemId: item.Entry.Id, excludeItemId: null, isFavorite: true, cursor: null, limit: 50);

        Assert.Single(page.Items);
        Assert.Equal(favoriteWithItem.Id, page.Items[0].Id);
    }

    /// <summary>
    /// Favorites must never be silently truncated by pagination - a caller building the "즐겨찾는
    /// 보관함" quick-access section has to be able to walk every favorite page-by-page just like the
    /// main list, not assume a single default-limit page covers them all.
    /// </summary>
    [Fact]
    public async Task ListAsync_WithIsFavoriteFilter_ComposesWithPaginationWithoutDuplicateOrMissing()
    {
        var store = new CollectionStore(_dbContext);
        var baseTime = DateTimeOffset.UtcNow;
        var favoriteIds = new List<long>();
        for (var i = 0; i < 5; i++)
        {
            var (name, nameNormalized) = Normalize($"Favorite {i}");
            var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            await store.SetFavoriteAsync(_userId, created.Id, true, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
            favoriteIds.Add(created.Id);
        }
        var (unfavoritedName, unfavoritedNormalized) = Normalize("Not a favorite");
        await store.CreateAsync(_userId, unfavoritedName, unfavoritedNormalized, CollectionIcon.Folder, baseTime.AddMinutes(10));
        _dbContext.ChangeTracker.Clear();

        var firstPage = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: true, cursor: null, limit: 2);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPage = await store.ListAsync(
            _userId, itemId: null, excludeItemId: null, isFavorite: true, cursor: firstPage.NextCursor, limit: 2);
        Assert.Equal(2, secondPage.Items.Count);
        Assert.NotNull(secondPage.NextCursor);

        var thirdPage = await store.ListAsync(
            _userId, itemId: null, excludeItemId: null, isFavorite: true, cursor: secondPage.NextCursor, limit: 2);
        Assert.Single(thirdPage.Items);
        Assert.Null(thirdPage.NextCursor);

        var allReturnedIds = firstPage.Items.Concat(secondPage.Items).Concat(thirdPage.Items)
            .Select(c => c.Id)
            .ToList();
        Assert.Equal(5, allReturnedIds.Distinct().Count());
        Assert.Equal(favoriteIds.OrderByDescending(id => id), allReturnedIds);
    }

    [Fact]
    public async Task CreateAsync_WithNoExplicitColor_PersistsNullColor()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");

        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);

        Assert.Null(created.Color);
    }

    [Fact]
    public async Task CreateAsync_WithExplicitColor_PersistsAndRoundTripsColor()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");

        var created = await store.CreateAsync(
            _userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow, CollectionColor.Mint);
        var fetched = await store.GetAsync(_userId, created.Id);

        Assert.Equal("Mint", created.Color);
        Assert.Equal("Mint", fetched.Color);
    }

    [Fact]
    public async Task SetColorAsync_UpdatesColorAndUpdatedAtUtc()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);
        var updatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(1);

        var updated = await store.SetColorAsync(_userId, created.Id, CollectionColor.Rose, updatedAtUtc);

        Assert.Equal("Rose", updated.Color);
        Assert.Equal(updatedAtUtc, updated.UpdatedAtUtc);
    }

    /// <summary>
    /// The exact "기존 category의 visual을 깨뜨리지 않기" contract: a Collection created before this
    /// feature (simulated here by never calling SetColorAsync at all) must keep reading back as a
    /// null Color from every read path (GetAsync/ListAsync), so the client's existing
    /// id-deterministic palette fallback stays in effect - never silently backfilled to some color.
    /// </summary>
    [Fact]
    public async Task LegacyCollection_WithoutExplicitColor_StaysNullAcrossGetAndList()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Legacy collection");
        var created = await store.CreateAsync(_userId, name, nameNormalized, CollectionIcon.Folder, DateTimeOffset.UtcNow);

        var fetched = await store.GetAsync(_userId, created.Id);
        var listed = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 10);

        Assert.Null(fetched.Color);
        Assert.Null(listed.Items.Single(item => item.Id == created.Id).Color);
    }
}
