using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemHistoryByDate;

namespace Juple.UnitTests.Items;

public sealed class GetItemHistoryByDateServiceTests
{
    [Fact]
    public async Task GetAsync_FiltersUsingCurrentUserAndConvertsLocalDateToUtcRange()
    {
        var expectedItems = new List<ItemHistoryEntryDto>
        {
            new(12, "https://example.test/newer", "Newer title", null, new DateTimeOffset(2026, 8, 29, 16, 0, 0, TimeSpan.Zero), null),
            new(11, "https://example.test/older", null, "Older memo", new DateTimeOffset(2026, 8, 29, 15, 0, 0, TimeSpan.Zero), null),
        };
        var store = new FakeItemHistoryQueryStore { DateRangeItems = expectedItems };
        var service = new GetItemHistoryByDateService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Equal(17, store.DateRangeUserId);
        Assert.Equal(expectedItems, result.Items);
        Assert.Equal(new DateOnly(2026, 8, 30), result.Date);
        // Asia/Seoul is UTC+9 with no DST - 2026-08-30 local midnight is 2026-08-29T15:00:00Z.
        Assert.Equal(new DateTimeOffset(2026, 8, 29, 15, 0, 0, TimeSpan.Zero), store.DateRangeFromUtc);
        Assert.Equal(new DateTimeOffset(2026, 8, 30, 15, 0, 0, TimeSpan.Zero), store.DateRangeToUtc);
    }

    [Fact]
    public async Task GetAsync_PassesCursorAndLimitThroughToStore()
    {
        var cursor = new ItemHistoryPageCursor(new DateTimeOffset(2026, 8, 30, 3, 0, 0, TimeSpan.Zero), 41);
        var store = new FakeItemHistoryQueryStore();
        var service = new GetItemHistoryByDateService(store, new FakeItemImageStorage());

        await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor, limit: 2);

        Assert.Equal(cursor, store.DateRangeCursor);
        Assert.Equal(2, store.DateRangeLimit);
    }

    [Fact]
    public async Task GetAsync_WhenStoreReturnsNextCursor_PropagatesItToResult()
    {
        var nextCursor = new ItemHistoryPageCursor(new DateTimeOffset(2026, 8, 30, 1, 0, 0, TimeSpan.Zero), 7);
        var store = new FakeItemHistoryQueryStore { NextCursor = nextCursor };
        var service = new GetItemHistoryByDateService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Equal(nextCursor, result.NextCursor);
    }

    [Fact]
    public async Task GetAsync_WhenStoreReturnsNoNextCursor_ResultNextCursorIsNull()
    {
        var store = new FakeItemHistoryQueryStore { NextCursor = null };
        var service = new GetItemHistoryByDateService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Null(result.NextCursor);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasRepresentativeImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/img.jpg?sas=1");
        var items = new List<ItemHistoryEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemHistoryQueryStore
        {
            DateRangeItems = items,
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetItemHistoryByDateService(store, imageStorage);

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Equal(new RepresentativeImageDto(9, readUrl), result.Items[0].RepresentativeImage);
        Assert.Equal((17L, "items/17/41/img.jpg"), imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasNoImage_RepresentativeImageIsNull()
    {
        var items = new List<ItemHistoryEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, null),
        };
        var store = new FakeItemHistoryQueryStore { DateRangeItems = items };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetItemHistoryByDateService(store, imageStorage);

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Null(result.Items[0].RepresentativeImage);
        Assert.Null(imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenReadUrlCreationFails_RepresentativeImageIsNullButRequestStillSucceeds()
    {
        var items = new List<ItemHistoryEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemHistoryQueryStore
        {
            DateRangeItems = items,
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = null };
        var service = new GetItemHistoryByDateService(store, imageStorage);

        var result = await service.GetAsync(17, "Asia/Seoul", new DateOnly(2026, 8, 30), cursor: null, limit: 50);

        Assert.Null(result.Items[0].RepresentativeImage);
    }

    private sealed class FakeItemHistoryQueryStore : IItemHistoryQueryStore
    {
        public long? DateRangeUserId { get; private set; }

        public DateTimeOffset? DateRangeFromUtc { get; private set; }

        public DateTimeOffset? DateRangeToUtc { get; private set; }

        public ItemHistoryPageCursor? DateRangeCursor { get; private set; }

        public int? DateRangeLimit { get; private set; }

        public IReadOnlyList<ItemHistoryEntryDto> DateRangeItems { get; init; } = [];

        public ItemHistoryPageCursor? NextCursor { get; init; }

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetHistoryAsync(
            long userId,
            ItemHistoryPageCursor? cursor,
            int limit,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetItemHistoryByDateService tests.");

        public Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetByDateRangeAsync(
            long userId,
            DateTimeOffset fromUtc,
            DateTimeOffset toUtc,
            ItemHistoryPageCursor? cursor,
            int limit,
            CancellationToken cancellationToken = default)
        {
            DateRangeUserId = userId;
            DateRangeFromUtc = fromUtc;
            DateRangeToUtc = toUtc;
            DateRangeCursor = cursor;
            DateRangeLimit = limit;
            return Task.FromResult((new ItemHistoryPage(DateRangeItems, NextCursor), RepresentativeImages));
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public Uri? ReadUrl { get; init; }

        public (long UserId, string BlobName)? LastCreateReadUrlCall { get; private set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            LastCreateReadUrlCall = (userId, blobName);
            return Task.FromResult(ReadUrl);
        }
    }
}
