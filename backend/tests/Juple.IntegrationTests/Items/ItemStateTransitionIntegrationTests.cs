using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

public sealed class ItemStateTransitionIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run item state transition integration tests " +
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
    public async Task MoveToWishlistAsync_RemovesItemFromDailyInboxResults()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/state-a", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.MoveToWishlistAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var dailyItems = await store.GetDailyAsync(
            _userId, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        Assert.DoesNotContain(dailyItems, item => item.Id == saved.Entry.Id);
    }

    [Fact]
    public async Task MoveToArchiveAsync_RemovesItemFromDailyInboxResults()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/state-b", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.MoveToArchiveAsync(_userId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var dailyItems = await store.GetDailyAsync(
            _userId, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        Assert.DoesNotContain(dailyItems, item => item.Id == saved.Entry.Id);
    }

    [Fact]
    public async Task SaveAsync_ReplayAfterMoveToWishlist_DoesNotCreateDuplicateAndKeepsWishlistState()
    {
        var store = new ItemStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        const string url = "https://shop.example/state-replay";

        var first = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await store.MoveToWishlistAsync(_userId, first.Entry.Id, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var replay = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);

        Assert.False(replay.Created);
        Assert.Equal(first.Entry.Id, replay.Entry.Id);
        Assert.Equal(1, await CountSaveRequestsAsync(clientRequestId));

        var state = await _dbContext.Items
            .AsNoTracking()
            .Where(item => item.Id == first.Entry.Id)
            .Select(item => item.State)
            .SingleAsync();
        Assert.Equal(Juple.Domain.Items.ItemState.Wishlist, state);
    }

    [Fact]
    public async Task ConcurrentWrites_WhenRowVersionIsStale_ThrowsDbUpdateConcurrencyException()
    {
        var store = new ItemStore(_dbContext);
        var saved = await store.SaveAsync(
            _userId, "https://shop.example/state-concurrency", null, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);

        var firstLoad = await _dbContext.Items.FirstAsync(item => item.Id == saved.Entry.Id);
        var secondLoad = await otherDbContext.Items.FirstAsync(item => item.Id == saved.Entry.Id);

        firstLoad.MoveToWishlist(DateTimeOffset.UtcNow);
        await _dbContext.SaveChangesAsync();

        secondLoad.MoveToArchive(DateTimeOffset.UtcNow);
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => otherDbContext.SaveChangesAsync());
    }

    private async Task<int> CountSaveRequestsAsync(Guid clientRequestId) =>
        await _dbContext.ItemSaveRequests
            .Where(request => request.UserId == _userId && request.ClientRequestId == clientRequestId)
            .CountAsync();
}
