using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;

namespace Juple.UnitTests.Items;

public sealed class DeleteItemServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserItemIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 22, 0, 0, 0, TimeSpan.Zero);
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider(now));

        await service.DeleteAsync(userId: 17, itemId: 41);

        Assert.Equal((17L, 41L, now), lifecycleStore.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var lifecycleStore = new FakeItemLifecycleStore { ThrowConcurrency = true };
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider());

        await Assert.ThrowsAsync<ItemConcurrencyException>(() => service.DeleteAsync(17, 41));
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider());

        await service.DeleteAsync(17, 41);
        await service.DeleteAsync(17, 41);

        Assert.Equal(2, lifecycleStore.DeleteCallCount);
    }

    [Fact]
    public async Task DeleteAsync_AlwaysEnforcesRetentionAfterSoftDelete()
    {
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider());

        await service.DeleteAsync(17, 41);

        Assert.Equal((17L, ItemTrashLimits.MaxRetainedPerUser), lifecycleStore.LastPurgeCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenRetentionPurgesOldItems_CleansUpTheirBlobsButNotTheJustDeletedItems()
    {
        var lifecycleStore = new FakeItemLifecycleStore { ItemIdsToPurge = [101, 102] };
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider());

        await service.DeleteAsync(17, 41);

        Assert.Equal([101L, 102L], imageStorage.DeleteItemBlobsCalls.Select(call => call.ItemId));
        Assert.All(imageStorage.DeleteItemBlobsCalls, call => Assert.Equal(17L, call.UserId));
    }

    [Fact]
    public async Task DeleteAsync_WhenNothingToPurge_NeverCallsBlobCleanup()
    {
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage, new FixedTimeProvider());

        await service.DeleteAsync(17, 41);

        Assert.Empty(imageStorage.DeleteItemBlobsCalls);
    }

    private sealed class FakeItemLifecycleStore : IItemLifecycleStore
    {
        public bool ThrowConcurrency { get; init; }

        public IReadOnlyList<long> ItemIdsToPurge { get; init; } = [];

        public int DeleteCallCount { get; private set; }

        public (long UserId, long ItemId, DateTimeOffset DeletedAtUtc)? LastDeleteCall { get; private set; }

        public (long UserId, int MaxRetained)? LastPurgeCall { get; private set; }

        public Task DeleteAsync(
            long userId, long itemId, DateTimeOffset deletedAtUtc, CancellationToken cancellationToken = default)
        {
            DeleteCallCount++;
            LastDeleteCall = (userId, itemId, deletedAtUtc);

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }

        public Task RestoreAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteItemService tests.");

        public Task PermanentDeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteItemService tests.");

        public Task<IReadOnlyList<long>> EmptyTrashAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteItemService tests.");

        public Task<IReadOnlyList<long>> PurgeOldestDeletedBeyondRetentionAsync(
            long userId, int maxRetained, CancellationToken cancellationToken = default)
        {
            LastPurgeCall = (userId, maxRetained);
            return Task.FromResult(ItemIdsToPurge);
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public List<(long UserId, long ItemId)> DeleteItemBlobsCalls { get; } = [];

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            DeleteItemBlobsCalls.Add((userId, itemId));
            return Task.CompletedTask;
        }

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 22, 0, 0, 0, TimeSpan.Zero);
    }
}
