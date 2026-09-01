using Juple.Application.Items;
using Juple.Application.Items.ItemStateTransition;

namespace Juple.UnitTests.Items;

public sealed class ItemStateTransitionServiceTests
{
    [Fact]
    public async Task MoveToWishlistAsync_CallsStoreWithCurrentUserItemAndServerTime()
    {
        var store = new FakeItemLifecycleStore();
        var utcNow = new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);
        var service = new ItemStateTransitionService(store, new FixedTimeProvider(utcNow));

        await service.MoveToWishlistAsync(userId: 17, itemId: 41);

        Assert.Equal((17L, 41L, utcNow), store.LastWishlistCall);
    }

    [Fact]
    public async Task MoveToArchiveAsync_CallsStoreWithCurrentUserItemAndServerTime()
    {
        var store = new FakeItemLifecycleStore();
        var utcNow = new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);
        var service = new ItemStateTransitionService(store, new FixedTimeProvider(utcNow));

        await service.MoveToArchiveAsync(userId: 17, itemId: 41);

        Assert.Equal((17L, 41L, utcNow), store.LastArchiveCall);
    }

    [Fact]
    public async Task MoveToWishlistAsync_WhenItemNotFoundOrNotOwned_PropagatesItemNotFoundException()
    {
        var store = new FakeItemLifecycleStore { ThrowNotFound = true };
        var service = new ItemStateTransitionService(store, new FixedTimeProvider(DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.MoveToWishlistAsync(17, 41));
    }

    [Fact]
    public async Task MoveToArchiveAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var store = new FakeItemLifecycleStore { ThrowConcurrency = true };
        var service = new ItemStateTransitionService(store, new FixedTimeProvider(DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<ItemConcurrencyException>(() => service.MoveToArchiveAsync(17, 41));
    }

    [Fact]
    public async Task MoveToWishlistAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var store = new FakeItemLifecycleStore();
        var service = new ItemStateTransitionService(store, new FixedTimeProvider(DateTimeOffset.UtcNow));

        await service.MoveToWishlistAsync(17, 41);
        await service.MoveToWishlistAsync(17, 41);

        Assert.Equal(2, store.WishlistCallCount);
    }

    private sealed class FakeItemLifecycleStore : IItemLifecycleStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public int WishlistCallCount { get; private set; }

        public (long UserId, long ItemId, DateTimeOffset ChangedAtUtc)? LastWishlistCall { get; private set; }

        public (long UserId, long ItemId, DateTimeOffset ChangedAtUtc)? LastArchiveCall { get; private set; }

        public Task MoveToWishlistAsync(
            long userId, long itemId, DateTimeOffset changedAtUtc, CancellationToken cancellationToken = default)
        {
            WishlistCallCount++;
            LastWishlistCall = (userId, itemId, changedAtUtc);
            ThrowIfConfigured();
            return Task.CompletedTask;
        }

        public Task MoveToArchiveAsync(
            long userId, long itemId, DateTimeOffset changedAtUtc, CancellationToken cancellationToken = default)
        {
            LastArchiveCall = (userId, itemId, changedAtUtc);
            ThrowIfConfigured();
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            ThrowIfConfigured();
            return Task.CompletedTask;
        }

        private void ThrowIfConfigured()
        {
            if (ThrowNotFound)
            {
                throw new ItemNotFoundException();
            }

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }
}
