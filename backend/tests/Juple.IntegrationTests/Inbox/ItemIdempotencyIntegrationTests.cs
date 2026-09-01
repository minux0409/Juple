using Juple.Application.Inbox;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Inbox;

public sealed class ItemIdempotencyIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run inbox idempotency integration tests " +
                "against a local SQL Server instance.");

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
            $"DELETE FROM items.ItemSaveRequests WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task SaveAsync_FirstRequestWithClientRequestId_CreatesEntry()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();

        var result = await store.SaveAsync(
            _userId, "https://shop.example/idempotency-a", clientRequestId, DateTimeOffset.UtcNow);

        Assert.True(result.Created);
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
    }

    [Fact]
    public async Task SaveAsync_ReplayWithSameUrl_DoesNotCreateSecondRow()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        const string url = "https://shop.example/idempotency-b";

        var first = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var replay = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);

        Assert.True(first.Created);
        Assert.False(replay.Created);
        Assert.Equal(first.Entry.Id, replay.Entry.Id);
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
        Assert.Equal(1, await CountItemsAsync());
    }

    [Fact]
    public async Task SaveAsync_ReplayWithDifferentUrl_ThrowsConflictAndDoesNotCreateRow()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();

        await store.SaveAsync(
            _userId, "https://shop.example/idempotency-c1", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            store.SaveAsync(
                _userId, "https://shop.example/idempotency-c2", clientRequestId, DateTimeOffset.UtcNow));

        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
        Assert.Equal(1, await CountItemsAsync());
    }

    [Fact]
    public async Task SaveAsync_WithoutClientRequestId_AllowsSameUrlTwice()
    {
        var store = new ItemStore(_dbContext);
        const string url = "https://shop.example/idempotency-d";

        var first = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        var second = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);

        Assert.True(first.Created);
        Assert.True(second.Created);
        Assert.NotEqual(first.Entry.Id, second.Entry.Id);
    }

    [Fact]
    public async Task SaveAsync_WithoutClientRequestId_CreatesNoSaveRequestRow()
    {
        var store = new ItemStore(_dbContext);

        await store.SaveAsync(_userId, "https://shop.example/idempotency-manual", null, DateTimeOffset.UtcNow);

        Assert.Equal(0, await _dbContext.ItemSaveRequests.Where(request => request.UserId == _userId).CountAsync());
    }

    [Fact]
    public async Task SaveAsync_ReplayAfterItemHardDeleted_DoesNotRecreateItemAndReturnsOriginalSnapshot()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        const string url = "https://shop.example/idempotency-deleted";
        var savedAt = DateTimeOffset.UtcNow;

        var first = await store.SaveAsync(_userId, url, clientRequestId, savedAt);
        _dbContext.ChangeTracker.Clear();

        // Uses the real Item.DeleteAsync path (not a raw SQL simulation) to prove the ledger is
        // fully independent of the Item's own lifecycle - this is the core success criterion of
        // the idempotency-ledger refactor.
        await store.DeleteAsync(_userId, first.Entry.Id);
        _dbContext.ChangeTracker.Clear();

        var replay = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);

        Assert.False(replay.Created);
        Assert.Equal(first.Entry.Id, replay.Entry.Id);
        Assert.Equal(url, replay.Entry.Url);
        Assert.Equal(first.Entry.SavedAtUtc, replay.Entry.SavedAtUtc);
        Assert.Equal(0, await CountItemsAsync());
    }

    [Fact]
    public async Task SaveAsync_ReplayWithDifferentUrlAfterItemHardDeleted_StillThrowsConflict()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();

        var first = await store.SaveAsync(
            _userId, "https://shop.example/idempotency-deleted-c1", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.DeleteAsync(_userId, first.Entry.Id);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            store.SaveAsync(
                _userId, "https://shop.example/idempotency-deleted-c2", clientRequestId, DateTimeOffset.UtcNow));

        Assert.Equal(0, await CountItemsAsync());
    }

    [Fact]
    public async Task SaveAsync_ConcurrentSameClientRequestId_CreatesExactlyOneItemAndOneSaveRequest()
    {
        var clientRequestId = Guid.NewGuid();
        const string url = "https://shop.example/idempotency-race";
        var savedAt = DateTimeOffset.UtcNow;

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var dbContextA = new JupleDbContext(options);
        await using var dbContextB = new JupleDbContext(options);
        var storeA = new ItemStore(dbContextA);
        var storeB = new ItemStore(dbContextB);

        var results = await Task.WhenAll(
            storeA.SaveAsync(_userId, url, clientRequestId, savedAt),
            storeB.SaveAsync(_userId, url, clientRequestId, savedAt));

        Assert.Single(results, result => result.Created);
        Assert.Single(results, result => !result.Created);
        Assert.Equal(results[0].Entry.Id, results[1].Entry.Id);
        Assert.Equal(1, await CountItemsAsync());
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));
    }

    private async Task<int> CountSaveRequestsAsync(Guid clientRequestId) =>
        await _dbContext.ItemSaveRequests
            .Where(request => request.UserId == _userId && request.ClientRequestId == clientRequestId)
            .CountAsync();

    private async Task<int> CountItemsAsync() =>
        await _dbContext.Items.Where(item => item.UserId == _userId).CountAsync();
}
