using Juple.Application.Items;
using Juple.Application.Items.GetRecentlyOpenedLinks;

namespace Juple.UnitTests.Items;

public sealed class GetRecentlyOpenedLinksServiceTests
{
    [Fact]
    public async Task GetAsync_CallsStoreWithCurrentUserCursorAndLimit_ReturnsItsResult()
    {
        var cursor = new RecentlyOpenedItemPageCursor(DateTimeOffset.UtcNow, 41);
        var expected = new RecentlyOpenedItemPage(
            [new RecentlyOpenedItemEntryDto(41, "https://shop.example/a", "A", DateTimeOffset.UtcNow)],
            NextCursor: null);
        var store = new FakeRecentlyOpenedItemStore { ResultToReturn = expected };
        var service = new GetRecentlyOpenedLinksService(store);

        var result = await service.GetAsync(17, cursor, 25);

        Assert.Equal(17, store.LastUserId);
        Assert.Same(cursor, store.LastCursor);
        Assert.Equal(25, store.LastLimit);
        Assert.Same(expected, result);
    }

    private sealed class FakeRecentlyOpenedItemStore : IRecentlyOpenedItemStore
    {
        public RecentlyOpenedItemPage? ResultToReturn { get; init; }

        public long? LastUserId { get; private set; }

        public RecentlyOpenedItemPageCursor? LastCursor { get; private set; }

        public int? LastLimit { get; private set; }

        public Task RecordOpenAsync(
            long userId, long itemId, DateTimeOffset openedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetRecentlyOpenedLinksService tests.");

        public Task<RecentlyOpenedItemPage> GetPageAsync(
            long userId, RecentlyOpenedItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCursor = cursor;
            LastLimit = limit;
            return Task.FromResult(ResultToReturn ?? new RecentlyOpenedItemPage([], null));
        }

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetRecentlyOpenedLinksService tests.");

        public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetRecentlyOpenedLinksService tests.");
    }
}
