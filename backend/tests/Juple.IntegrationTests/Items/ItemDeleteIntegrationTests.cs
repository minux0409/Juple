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
    public async Task DeleteAsync_ExistingItem_RemovesFromHistory()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(_userId, "https://shop.example/delete-history", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, saved.Entry.Id);
        _dbContext.ChangeTracker.Clear();

        var (page, _) = await store.GetHistoryAsync(_userId, cursor: null, limit: 50);

        Assert.DoesNotContain(page.Items, item => item.Id == saved.Entry.Id);
        Assert.Equal(0, await CountItemsAsync(saved.Entry.Id));
    }

    [Fact]
    public async Task DeleteAsync_ItemThatNeverExisted_CompletesWithoutException()
    {
        var store = new ItemStore(_dbContext);

        await store.DeleteAsync(_userId, itemId: -1);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SecondCallCompletesWithoutExceptionAndNoSideEffect()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-repeat", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, saved.Entry.Id);
        _dbContext.ChangeTracker.Clear();
        await store.DeleteAsync(_userId, saved.Entry.Id);

        Assert.Equal(0, await CountItemsAsync(saved.Entry.Id));
    }

    [Fact]
    public async Task DeleteAsync_OtherUsersItem_DoesNotDeleteAndCompletesWithoutException()
    {
        var store = new ItemStore(_dbContext);
        var ownersItem = await store.SaveAsync(
            _otherUserId, "https://shop.example/delete-other-user", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, ownersItem.Entry.Id);

        Assert.Equal(1, await CountItemsAsync(ownersItem.Entry.Id));
    }

    [Fact]
    public async Task DeleteAsync_ShareCreatedItem_RemovesItemButKeepsLedgerRow()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/delete-share", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var ledgerCountBefore = await CountSaveRequestsAsync(clientRequestId);

        await store.DeleteAsync(_userId, saved.Entry.Id);

        Assert.Equal(0, await CountItemsAsync(saved.Entry.Id));
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
            () => otherStore.DeleteAsync(_userId, saved.Entry.Id));

        Assert.Equal(1, await CountItemsAsync(saved.Entry.Id));
    }

    [Fact]
    public async Task DeleteAsync_ConcurrentDeleteOfSameItem_BothCompleteWithoutException()
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
        // loser's DbUpdateConcurrencyException must be normalized to "already absent".
        await Task.WhenAll(
            storeA.DeleteAsync(_userId, saved.Entry.Id),
            storeB.DeleteAsync(_userId, saved.Entry.Id));

        Assert.Equal(0, await CountItemsAsync(saved.Entry.Id));
    }

    private async Task<int> CountItemsAsync(long itemId) =>
        await _dbContext.Items.Where(item => item.Id == itemId).CountAsync();

    private async Task<int> CountSaveRequestsAsync(Guid clientRequestId) =>
        await _dbContext.ItemSaveRequests
            .Where(request => request.UserId == _userId && request.ClientRequestId == clientRequestId)
            .CountAsync();
}
