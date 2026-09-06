using Juple.Application.Items;
using Juple.Application.Items.RecordItemOpen;

namespace Juple.UnitTests.Items;

public sealed class RecordItemOpenServiceTests
{
    [Fact]
    public async Task RecordAsync_CallsStoreWithCurrentUserItemIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 6, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeRecentlyOpenedItemStore();
        var service = new RecordItemOpenService(store, new FixedTimeProvider(now));

        await service.RecordAsync(17, 41);

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Equal(now, store.LastOpenedAtUtc);
    }

    [Fact]
    public async Task RecordAsync_WhenItemNotFound_PropagatesItemNotFoundException()
    {
        var store = new FakeRecentlyOpenedItemStore { ThrowNotFound = true };
        var service = new RecordItemOpenService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.RecordAsync(17, 41));
    }

    private sealed class FakeRecentlyOpenedItemStore : IRecentlyOpenedItemStore
    {
        public bool ThrowNotFound { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public DateTimeOffset? LastOpenedAtUtc { get; private set; }

        public Task RecordOpenAsync(
            long userId, long itemId, DateTimeOffset openedAtUtc, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            LastOpenedAtUtc = openedAtUtc;

            if (ThrowNotFound)
            {
                throw new ItemNotFoundException();
            }

            return Task.CompletedTask;
        }

        public Task<RecentlyOpenedItemPage> GetPageAsync(
            long userId, RecentlyOpenedItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by RecordItemOpenService tests.");

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by RecordItemOpenService tests.");

        public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by RecordItemOpenService tests.");
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 6, 0, 0, 0, TimeSpan.Zero);
    }
}
