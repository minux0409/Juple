using Juple.Application.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class ItemDeleteIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item delete integration tests " +
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
            $"DELETE FROM items.ItemSaveRequests WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task DeleteAsync_ExistingItem_SetsDeletedAtUtcAndRemovesFromHistory()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/delete-history", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var deletedAtUtc = DateTimeOffset.UtcNow;

        await store.DeleteAsync(_userId, saved.Entry.Id, deletedAtUtc);
        _dbContext.ChangeTracker.Clear();

        var (page, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.DoesNotContain(page.Items, item => item.Id == saved.Entry.Id);
        Assert.Equal(1, await CountItemsAsync(saved.Entry.Id));
        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Equal(deletedAtUtc, row.DeletedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_ItemThatNeverExisted_CompletesWithoutException()
    {
        var store = new ItemStore(_dbContext);

        await store.DeleteAsync(_userId, itemId: -1, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SecondCallCompletesWithoutExceptionAndKeepsFirstDeletedAtUtc()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-repeat", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var firstDeletedAtUtc = DateTimeOffset.UtcNow;

        await store.DeleteAsync(_userId, saved.Entry.Id, firstDeletedAtUtc);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, saved.Entry.Id, firstDeletedAtUtc.AddMinutes(1));
        _dbContext.ChangeTracker.Clear();

        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Equal(firstDeletedAtUtc, row.DeletedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_OtherUsersItem_DoesNotDeleteAndCompletesWithoutException()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/delete-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, ownersItem.Entry.Id, DateTimeOffset.UtcNow);

        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == ownersItem.Entry.Id);
        Assert.Null(row.DeletedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_ShareCreatedItem_SoftDeletesItemButKeepsLedgerRow()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-share", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var ledgerCountBefore = await CountSaveRequestsAsync(clientRequestId);

        await store.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);

        Assert.Equal(1, await CountItemsAsync(saved.Entry.Id));
        Assert.Equal(ledgerCountBefore, await CountSaveRequestsAsync(clientRequestId));
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
    }

    [Fact]
    public async Task DeleteAsync_WhenConcurrentTransitionModifiesItem_ThrowsItemConcurrencyException()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-concurrency", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherStore = new ItemStore(otherDbContext);

        // Pre-load the Item into otherDbContext before the concurrent transition below commits.
        // Once that transition succeeds, otherDbContext's tracked copy is stale; DeleteAsync's own
        // internal query later returns this same tracked instance rather than the fresh row (EF
        // does not overwrite an already-tracked entity's values), deterministically reproducing a
        // real concurrent-modification race without relying on timing.
        await otherDbContext.Items.FirstAsync(item => item.Id == saved.Entry.Id);

        var concurrentLoad = await _dbContext.Items.FirstAsync(item => item.Id == saved.Entry.Id);
        concurrentLoad.UpdateDetails("Concurrent title", null);
        await _dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<ItemConcurrencyException>(
            () => otherStore.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow));

        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Null(row.DeletedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_ConcurrentDeleteOfSameItem_BothCompleteWithoutExceptionAndItemEndsUpDeleted()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-race", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var dbContextA = new JupleDbContext(options);
        await using var dbContextB = new JupleDbContext(options);
        var storeA = new ItemStore(dbContextA);
        var storeB = new ItemStore(dbContextB);

        // Both requests race to delete the same Item; the DB's optimistic-concurrency check (not
        // an app-level lock) decides the winner. Neither call may surface an exception: the
        // loser's DbUpdateConcurrencyException must be normalized to "already deleted".
        await Task.WhenAll(
            storeA.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow),
            storeB.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow));

        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.NotNull(row.DeletedAtUtc);
    }

    [Fact]
    public async Task RestoreAsync_DeletedItem_ClearsDeletedAtUtcAndReappearsInHistory()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/restore-a", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.RestoreAsync(_userId, saved.Entry.Id);
        _dbContext.ChangeTracker.Clear();

        var row = await _dbContext.Items.AsNoTracking().SingleAsync(item => item.Id == saved.Entry.Id);
        Assert.Null(row.DeletedAtUtc);
        var (page, _, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);
        Assert.Contains(page.Items, item => item.Id == saved.Entry.Id);
    }

    [Fact]
    public async Task RestoreAsync_ItemThatIsNotDeleted_ThrowsItemNotFoundException()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/restore-active", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.RestoreAsync(_userId, saved.Entry.Id));
    }

    [Fact]
    public async Task RestoreAsync_OtherUsersDeletedItem_ThrowsItemNotFoundException()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/restore-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_otherUserId, ownersItem.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.RestoreAsync(_userId, ownersItem.Entry.Id));
    }

    [Fact]
    public async Task PermanentDeleteAsync_DeletedItem_RemovesRow()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/permanent-a", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.PermanentDeleteAsync(_userId, saved.Entry.Id);

        Assert.Equal(0, await CountItemsAsync(saved.Entry.Id));
    }

    [Fact]
    public async Task PermanentDeleteAsync_ActiveItem_ThrowsItemNotFoundExceptionAndDoesNotDelete()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/permanent-active", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.PermanentDeleteAsync(_userId, saved.Entry.Id));

        Assert.Equal(1, await CountItemsAsync(saved.Entry.Id));
    }

    [Fact]
    public async Task PermanentDeleteAsync_OtherUsersDeletedItem_ThrowsItemNotFoundExceptionAndDoesNotDelete()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/permanent-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_otherUserId, ownersItem.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ItemNotFoundException>(() => store.PermanentDeleteAsync(_userId, ownersItem.Entry.Id));

        Assert.Equal(1, await CountItemsAsync(ownersItem.Entry.Id));
    }

    [Fact]
    public async Task EmptyTrashAsync_RemovesOnlyCallersDeletedItems()
    {
        var store = new ItemStore(_dbContext);
        var deletedA = await store.SaveAsync(_userId, "https://shop.example/empty-a", null, DateTimeOffset.UtcNow);
        var deletedB = await store.SaveAsync(_userId, "https://shop.example/empty-b", null, DateTimeOffset.UtcNow);
        var activeItem = await store.SaveAsync(_userId, "https://shop.example/empty-active", null, DateTimeOffset.UtcNow);
        var otherUsersDeletedItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/empty-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, deletedA.Entry.Id, DateTimeOffset.UtcNow);
        await store.DeleteAsync(_userId, deletedB.Entry.Id, DateTimeOffset.UtcNow);
        await store.DeleteAsync(_otherUserId, otherUsersDeletedItem.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var purgedIds = await store.EmptyTrashAsync(_userId);

        Assert.Equal([deletedA.Entry.Id, deletedB.Entry.Id], purgedIds.OrderBy(id => id));
        Assert.Equal(0, await CountItemsAsync(deletedA.Entry.Id));
        Assert.Equal(0, await CountItemsAsync(deletedB.Entry.Id));
        Assert.Equal(1, await CountItemsAsync(activeItem.Entry.Id));
        Assert.Equal(1, await CountItemsAsync(otherUsersDeletedItem.Entry.Id));
    }

    [Fact]
    public async Task EmptyTrashAsync_WhenTrashIsEmpty_ReturnsEmptyListAndDoesNothing()
    {
        var store = new ItemStore(_dbContext);
        var activeItem = await store.SaveAsync(_userId, "https://shop.example/empty-noop", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var purgedIds = await store.EmptyTrashAsync(_userId);

        Assert.Empty(purgedIds);
        Assert.Equal(1, await CountItemsAsync(activeItem.Entry.Id));
    }

    [Fact]
    public async Task PurgeOldestDeletedBeyondRetentionAsync_PurgesOnlyTheOldestOverflowingItems()
    {
        var store = new ItemStore(_dbContext);
        var oldest = await store.SaveAsync(_userId, "https://shop.example/retention-1", null, DateTimeOffset.UtcNow);
        var middle = await store.SaveAsync(_userId, "https://shop.example/retention-2", null, DateTimeOffset.UtcNow);
        var newest = await store.SaveAsync(_userId, "https://shop.example/retention-3", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var baseTime = DateTimeOffset.UtcNow;
        await store.DeleteAsync(_userId, oldest.Entry.Id, baseTime);
        await store.DeleteAsync(_userId, middle.Entry.Id, baseTime.AddMinutes(1));
        await store.DeleteAsync(_userId, newest.Entry.Id, baseTime.AddMinutes(2));
        _dbContext.ChangeTracker.Clear();

        // maxRetained=2 with 3 deleted items -> the single oldest-by-DeletedAtUtc must be purged.
        var purgedIds = await store.PurgeOldestDeletedBeyondRetentionAsync(_userId, maxRetained: 2);

        Assert.Equal([oldest.Entry.Id], purgedIds);
        Assert.Equal(0, await CountItemsAsync(oldest.Entry.Id));
        Assert.Equal(1, await CountItemsAsync(middle.Entry.Id));
        Assert.Equal(1, await CountItemsAsync(newest.Entry.Id));
    }

    [Fact]
    public async Task PurgeOldestDeletedBeyondRetentionAsync_WhenAtOrUnderRetention_PurgesNothing()
    {
        var store = new ItemStore(_dbContext);
        var deleted = await store.SaveAsync(_userId, "https://shop.example/retention-noop", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, deleted.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var purgedIds = await store.PurgeOldestDeletedBeyondRetentionAsync(_userId, maxRetained: 100);

        Assert.Empty(purgedIds);
        Assert.Equal(1, await CountItemsAsync(deleted.Entry.Id));
    }

    private async Task<int> CountItemsAsync(long itemId) =>
        await _dbContext.Items.Where(item => item.Id == itemId).CountAsync();

    private async Task<int> CountSaveRequestsAsync(Guid clientRequestId) =>
        await _dbContext.ItemSaveRequests
            .Where(request => request.UserId == _userId && request.ClientRequestId == clientRequestId)
            .CountAsync();
}
