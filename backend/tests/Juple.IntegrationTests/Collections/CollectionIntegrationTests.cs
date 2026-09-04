using Juple.Application.Collections;
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
    public async Task CreateAsync_PersistsCollectionWithZeroItemCount()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var now = DateTimeOffset.UtcNow;

        var created = await store.CreateAsync(_userId, name, nameNormalized, now);

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
        await store.CreateAsync(_userId, nameA, normalizedA, baseTime);
        await store.CreateAsync(_userId, nameB, normalizedB, baseTime.AddMinutes(1));
        await store.CreateAsync(_userId, nameC, normalizedC, baseTime.AddMinutes(2));

        var page = await store.ListAsync(_userId, itemId: null, excludeItemId: null, isFavorite: null, cursor: null, limit: 50);

        Assert.Equal(["Recipes", "Electronics", "Books"], page.Items.Select(c => c.Name));
    }

    [Fact]
    public async Task ListAsync_ExcludesOtherUsersCollections()
    {
        var store = new CollectionStore(_dbContext);
        var (mineName, mineNormalized) = Normalize("Mine");
        var (theirsName, theirsNormalized) = Normalize("TheirsOnly");
        await store.CreateAsync(_userId, mineName, mineNormalized, DateTimeOffset.UtcNow);
        await store.CreateAsync(_otherUserId, theirsName, theirsNormalized, DateTimeOffset.UtcNow);

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
        var collection = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
            var created = await store.CreateAsync(_userId, name, nameNormalized, baseTime.AddMinutes(i));
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
            var created = await store.CreateAsync(_userId, name, nameNormalized, sameTime);
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
        await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_WhenNameDiffersOnlyByCase_ThrowsCollectionNameConflict()
    {
        // Verifies NameNormalized (app-level culture-invariant uppercase), not the database's
        // default collation, is what makes "Gift Ideas" and "gift ideas" collide - unlike
        // Category's UX_Categories_UserId_Name index, which relies on collation for this.
        var store = new CollectionStore(_dbContext);
        var (firstName, firstNormalized) = Normalize("Gift Ideas");
        await store.CreateAsync(_userId, firstName, firstNormalized, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var (secondName, secondNormalized) = Normalize("gift ideas");
        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => store.CreateAsync(_userId, secondName, secondNormalized, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task CreateAsync_WhenSameNameUsedByDifferentUser_Succeeds()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        await store.CreateAsync(_otherUserId, name, nameNormalized, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);

        Assert.Equal("Books to read", created.Name);
    }

    [Fact]
    public async Task GetAsync_ReturnsCollectionWithItemCount()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.GetAsync(_userId, theirs.Id));
    }

    [Fact]
    public async Task RenameAsync_PersistsNewNameAndUpdatedAtUtc()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        await store.CreateAsync(_userId, firstName, firstNormalized, DateTimeOffset.UtcNow);
        var second = await store.CreateAsync(_userId, secondName, secondNormalized, DateTimeOffset.UtcNow);
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
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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

        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);

        Assert.False(created.IsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_PersistsIsFavoriteAndUpdatesUpdatedAtUtc()
    {
        var store = new CollectionStore(_dbContext);
        var (name, nameNormalized) = Normalize("Books to read");
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var theirs = await store.CreateAsync(_otherUserId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var created = await store.CreateAsync(_userId, name, nameNormalized, DateTimeOffset.UtcNow);
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
        var favorite = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, DateTimeOffset.UtcNow);
        await store.CreateAsync(_userId, otherName, otherNormalized, DateTimeOffset.UtcNow);
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
        var favorite = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, DateTimeOffset.UtcNow);
        var other = await store.CreateAsync(_userId, otherName, otherNormalized, DateTimeOffset.UtcNow);
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
        var favoriteWithItem = await store.CreateAsync(_userId, favoriteName, favoriteNormalized, DateTimeOffset.UtcNow);
        var favoriteWithoutItem = await store.CreateAsync(_userId, otherFavoriteName, otherFavoriteNormalized, DateTimeOffset.UtcNow);
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
            var created = await store.CreateAsync(_userId, name, nameNormalized, baseTime.AddMinutes(i));
            _dbContext.ChangeTracker.Clear();
            await store.SetFavoriteAsync(_userId, created.Id, true, DateTimeOffset.UtcNow);
            _dbContext.ChangeTracker.Clear();
            favoriteIds.Add(created.Id);
        }
        var (unfavoritedName, unfavoritedNormalized) = Normalize("Not a favorite");
        await store.CreateAsync(_userId, unfavoritedName, unfavoritedNormalized, baseTime.AddMinutes(10));
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
}
