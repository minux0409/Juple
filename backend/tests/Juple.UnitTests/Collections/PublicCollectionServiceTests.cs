using Juple.Application.Collections;
using Juple.Application.Collections.Public;

namespace Juple.UnitTests.Collections;

public sealed class PublicCollectionServiceTests
{
    [Fact]
    public async Task GetCollectionAsync_PassesPublicIdThroughToStoreAndReturnsResult()
    {
        var expected = new PublicCollectionDto("Books to read");
        var store = new FakeStore { CollectionResult = expected };
        var service = new PublicCollectionService(store);

        var result = await service.GetCollectionAsync("abc123");

        Assert.Equal("abc123", store.LastGetCollectionPublicId);
        Assert.Same(expected, result);
    }

    [Fact]
    public async Task GetCollectionAsync_WhenStoreReturnsNull_ReturnsNull()
    {
        var store = new FakeStore { CollectionResult = null };
        var service = new PublicCollectionService(store);

        var result = await service.GetCollectionAsync("unknown");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetItemsAsync_PassesArgumentsThroughToStoreAndReturnsResult()
    {
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 3, 0, 0, TimeSpan.Zero), 41);
        var expected = new PublicCollectionItemPage([new PublicCollectionItemDto("Title", "https://example.test")], null);
        var store = new FakeStore { ItemsResult = expected };
        var service = new PublicCollectionService(store);

        var result = await service.GetItemsAsync("abc123", cursor, 2);

        Assert.Equal("abc123", store.LastGetItemsPublicId);
        Assert.Equal(cursor, store.LastGetItemsCursor);
        Assert.Equal(2, store.LastGetItemsLimit);
        Assert.Same(expected, result);
    }

    private sealed class FakeStore : IPublicCollectionShareStore
    {
        public PublicCollectionDto? CollectionResult { get; init; }

        public PublicCollectionItemPage? ItemsResult { get; init; }

        public string? LastGetCollectionPublicId { get; private set; }

        public string? LastGetItemsPublicId { get; private set; }

        public CollectionItemPageCursor? LastGetItemsCursor { get; private set; }

        public int? LastGetItemsLimit { get; private set; }

        public Task<PublicCollectionDto?> GetCollectionAsync(
            string publicId, CancellationToken cancellationToken = default)
        {
            LastGetCollectionPublicId = publicId;
            return Task.FromResult(CollectionResult);
        }

        public Task<PublicCollectionItemPage?> GetItemsAsync(
            string publicId, CollectionItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default)
        {
            LastGetItemsPublicId = publicId;
            LastGetItemsCursor = cursor;
            LastGetItemsLimit = limit;
            return Task.FromResult(ItemsResult);
        }
    }
}
