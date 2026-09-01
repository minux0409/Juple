using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;

namespace Juple.UnitTests.Items;

public sealed class DeleteItemServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserAndItemId()
    {
        var store = new FakeItemLifecycleStore();
        var service = new DeleteItemService(store);

        await service.DeleteAsync(userId: 17, itemId: 41);

        Assert.Equal((17L, 41L), store.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var store = new FakeItemLifecycleStore { ThrowConcurrency = true };
        var service = new DeleteItemService(store);

        await Assert.ThrowsAsync<ItemConcurrencyException>(() => service.DeleteAsync(17, 41));
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var store = new FakeItemLifecycleStore();
        var service = new DeleteItemService(store);

        await service.DeleteAsync(17, 41);
        await service.DeleteAsync(17, 41);

        Assert.Equal(2, store.DeleteCallCount);
    }

    private sealed class FakeItemLifecycleStore : IItemLifecycleStore
    {
        public bool ThrowConcurrency { get; init; }

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
            DeleteCallCount++;
            LastDeleteCall = (userId, itemId);

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }
    }
}
