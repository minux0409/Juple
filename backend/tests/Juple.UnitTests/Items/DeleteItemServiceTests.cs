using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;

namespace Juple.UnitTests.Items;

public sealed class DeleteItemServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserAndItemId()
    {
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage);

        await service.DeleteAsync(userId: 17, itemId: 41);

        Assert.Equal((17L, 41L), lifecycleStore.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var lifecycleStore = new FakeItemLifecycleStore { ThrowConcurrency = true };
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage);

        await Assert.ThrowsAsync<ItemConcurrencyException>(() => service.DeleteAsync(17, 41));
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage);

        await service.DeleteAsync(17, 41);
        await service.DeleteAsync(17, 41);

        Assert.Equal(2, lifecycleStore.DeleteCallCount);
    }

    [Fact]
    public async Task DeleteAsync_DeletesItemBeforeCleaningUpItsBlobsByPrefix()
    {
        var callOrder = new List<string>();
        var lifecycleStore = new FakeItemLifecycleStore { CallOrder = callOrder };
        var imageStorage = new FakeItemImageStorage { CallOrder = callOrder };
        var service = new DeleteItemService(lifecycleStore, imageStorage);

        await service.DeleteAsync(17, 41);

        Assert.Equal(["DeleteItem", "DeleteItemBlobs"], callOrder);
        Assert.Equal((17L, 41L), imageStorage.LastDeleteItemBlobsCall);
    }

    [Fact]
    public async Task DeleteAsync_OnMissingOrOtherUsersItem_StillCleansUpTheCallersOwnPrefixAndCompletes()
    {
        // IItemLifecycleStore.DeleteAsync is itself idempotent (no-op for missing/other-user
        // Items) - DeleteItemBlobsAsync is scoped to the caller's own userId/itemId prefix, so
        // calling it unconditionally can never reach another user's Blobs regardless of ownership.
        var lifecycleStore = new FakeItemLifecycleStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new DeleteItemService(lifecycleStore, imageStorage);

        await service.DeleteAsync(17, 41);

        Assert.Equal((17L, 41L), imageStorage.LastDeleteItemBlobsCall);
    }

    private sealed class FakeItemLifecycleStore : IItemLifecycleStore
    {
        public bool ThrowConcurrency { get; init; }

        public List<string>? CallOrder { get; init; }

        public int DeleteCallCount { get; private set; }

        public (long UserId, long ItemId)? LastDeleteCall { get; private set; }

        public Task MoveToWishlistAsync(
            long userId, long itemId, DateTimeOffset changedAtUtc, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MoveToArchiveAsync(
            long userId, long itemId, DateTimeOffset changedAtUtc, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            CallOrder?.Add("DeleteItem");
            DeleteCallCount++;
            LastDeleteCall = (userId, itemId);

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public List<string>? CallOrder { get; init; }

        public (long UserId, long ItemId)? LastDeleteItemBlobsCall { get; private set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            CallOrder?.Add("DeleteItemBlobs");
            LastDeleteItemBlobsCall = (userId, itemId);
            return Task.CompletedTask;
        }

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }
}
