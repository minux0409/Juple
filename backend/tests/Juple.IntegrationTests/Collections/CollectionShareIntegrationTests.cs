using Juple.Application.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

public sealed class CollectionShareIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run collection share integration " +
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
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.CollectionShares WHERE CollectionId IN (SELECT Id FROM collections.Collections WHERE UserId = {_userId} OR UserId = {_otherUserId})");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM collections.Collections WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private async Task<long> CreateCollectionAsync(CollectionStore store, long userId, string name) =>
        (await store.CreateAsync(userId, name, name.ToUpperInvariant(), DateTimeOffset.UtcNow)).Id;

    private static string NewCandidatePublicId() => Guid.NewGuid().ToString("N");

    [Fact]
    public async Task EnableAsync_CreatesActiveShareWithUnguessablePublicId()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);

        Assert.Equal(collectionId, share.CollectionId);
        Assert.True(share.PublicId.Length >= 16);
    }

    [Fact]
    public async Task EnableAsync_WhenAlreadyActive_ReturnsSameShareWithoutMintingANewOne()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var first = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var second = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);

        Assert.Equal(first.PublicId, second.PublicId);
    }

    [Fact]
    public async Task EnableAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _otherUserId, "TheirsOnly");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task EnableAsync_OnMissingCollection_ThrowsCollectionNotFound()
    {
        var shareStore = new CollectionShareStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => shareStore.EnableAsync(_userId, collectionId: -1, NewCandidatePublicId(), DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task GetActiveAsync_WhenNeverShared_ReturnsNull()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        var share = await shareStore.GetActiveAsync(_userId, collectionId);

        Assert.Null(share);
    }

    [Fact]
    public async Task GetActiveAsync_AfterEnable_ReturnsIt()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var enabled = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var fetched = await shareStore.GetActiveAsync(_userId, collectionId);

        Assert.NotNull(fetched);
        Assert.Equal(enabled.PublicId, fetched!.PublicId);
    }

    [Fact]
    public async Task GetActiveAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _otherUserId, "TheirsOnly");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => shareStore.GetActiveAsync(_userId, collectionId));
    }

    [Fact]
    public async Task RevokeAsync_MakesShareInactive_GetActiveReturnsNullAfter()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var afterRevoke = await shareStore.GetActiveAsync(_userId, collectionId);
        Assert.Null(afterRevoke);
    }

    [Fact]
    public async Task RevokeAsync_WhenNeverShared_CompletesWithoutException()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task RevokeAsync_CalledTwice_SecondCallCompletesWithoutException()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task RevokeAsync_OnOtherUsersCollection_ThrowsCollectionNotFound()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _otherUserId, "TheirsOnly");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task EnableAsync_AfterRevoke_GeneratesNewPublicIdAndOldOneStaysInactiveForever()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var firstShare = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        await shareStore.RevokeAsync(_userId, collectionId, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        var secondShare = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);

        Assert.NotEqual(firstShare.PublicId, secondShare.PublicId);

        // The old PublicId's row must still exist but stay permanently inactive - never
        // reactivated by the later EnableAsync call.
        var oldRow = await _dbContext.CollectionShares
            .AsNoTracking()
            .FirstAsync(share => share.PublicId == firstShare.PublicId);
        Assert.False(oldRow.IsActive);
    }

    /// <summary>
    /// Simulates two concurrent EnableAsync calls for the same Collection racing on
    /// UX_CollectionShares_CollectionId_Active - only one active share must ever exist afterward.
    /// </summary>
    [Fact]
    public async Task EnableAsync_ConcurrentCallsForSameCollection_OnlyOneActiveShareEverExists()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        await using var otherDbContext = new JupleDbContext(options);
        var otherShareStore = new CollectionShareStore(otherDbContext);
        var shareStore = new CollectionShareStore(_dbContext);

        // Both stores independently observe "no active share yet" before either commits, then
        // race to insert - exactly the TOCTOU window the filtered unique index exists to close.
        var firstTask = shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        var secondTask = otherShareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        var results = await Task.WhenAll(firstTask, secondTask);

        Assert.Equal(results[0].PublicId, results[1].PublicId);

        var activeCount = await _dbContext.CollectionShares
            .AsNoTracking()
            .CountAsync(share => share.CollectionId == collectionId && share.IsActive);
        Assert.Equal(1, activeCount);
    }

    [Fact]
    public async Task DeleteCollection_CascadesAwayItsShare()
    {
        var collectionStore = new CollectionStore(_dbContext);
        var collectionId = await CreateCollectionAsync(collectionStore, _userId, "Books");
        _dbContext.ChangeTracker.Clear();
        var shareStore = new CollectionShareStore(_dbContext);
        var share = await shareStore.EnableAsync(_userId, collectionId, NewCandidatePublicId(), DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();

        await collectionStore.DeleteAsync(_userId, collectionId);
        _dbContext.ChangeTracker.Clear();

        var stillExists = await _dbContext.CollectionShares
            .AsNoTracking()
            .AnyAsync(s => s.PublicId == share.PublicId);
        Assert.False(stillExists);
    }
}
