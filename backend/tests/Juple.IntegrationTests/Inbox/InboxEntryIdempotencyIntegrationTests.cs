using Juple.Application.Inbox;
using Juple.Domain.Users;
using Juple.Infrastructure.Inbox;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Inbox;

public sealed class InboxEntryIdempotencyIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run inbox idempotency integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
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
            $"DELETE FROM inbox.InboxEntries WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task SaveAsync_FirstRequestWithClientRequestId_CreatesEntry()
    {
        var store = new InboxEntryStore(_dbContext);
        var clientRequestId = Guid.NewGuid();

        var result = await store.SaveAsync(
            _userId, "https://shop.example/idempotency-a", clientRequestId, DateTimeOffset.UtcNow);

        Assert.True(result.Created);
        Assert.Equal(1, await CountEntriesAsync(clientRequestId));
    }

    [Fact]
    public async Task SaveAsync_ReplayWithSameUrl_DoesNotCreateSecondRow()
    {
        var store = new InboxEntryStore(_dbContext);
        var clientRequestId = Guid.NewGuid();
        const string url = "https://shop.example/idempotency-b";

        var first = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var replay = await store.SaveAsync(_userId, url, clientRequestId, DateTimeOffset.UtcNow);

        Assert.True(first.Created);
        Assert.False(replay.Created);
        Assert.Equal(first.Entry.Id, replay.Entry.Id);
        Assert.Equal(1, await CountEntriesAsync(clientRequestId));
    }

    [Fact]
    public async Task SaveAsync_ReplayWithDifferentUrl_ThrowsConflictAndDoesNotCreateRow()
    {
        var store = new InboxEntryStore(_dbContext);
        var clientRequestId = Guid.NewGuid();

        await store.SaveAsync(
            _userId, "https://shop.example/idempotency-c1", clientRequestId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            store.SaveAsync(
                _userId, "https://shop.example/idempotency-c2", clientRequestId, DateTimeOffset.UtcNow));

        Assert.Equal(1, await CountEntriesAsync(clientRequestId));
    }

    [Fact]
    public async Task SaveAsync_WithoutClientRequestId_AllowsSameUrlTwice()
    {
        var store = new InboxEntryStore(_dbContext);
        const string url = "https://shop.example/idempotency-d";

        var first = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);
        var second = await store.SaveAsync(_userId, url, null, DateTimeOffset.UtcNow);

        Assert.True(first.Created);
        Assert.True(second.Created);
        Assert.NotEqual(first.Entry.Id, second.Entry.Id);
    }

    private async Task<int> CountEntriesAsync(Guid clientRequestId) =>
        await _dbContext.InboxEntries
            .Where(entry => entry.UserId == _userId && entry.ClientRequestId == clientRequestId)
            .CountAsync();
}
