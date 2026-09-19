using Juple.Application.Collections;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Images;

namespace Juple.UnitTests.Collections;

public sealed class GetCollectionItemsServiceTests
{
    [Fact]
    public async Task GetAsync_PassesCollectionCursorAndLimitThroughToStore()
    {
        var cursor = new CollectionItemPageCursor(1024, 41);
        var store = new FakeCollectionItemStore();
        var service = new GetCollectionItemsService(store, new FakeItemImageStorage());

        await service.GetAsync(17, 9, cursor, limit: 2);

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(9, store.LastCollectionId);
        Assert.Equal(cursor, store.LastCursor);
        Assert.Equal(2, store.LastLimit);
    }

    [Fact]
    public async Task GetAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionItemStore { ThrowNotFound = true };
        var service = new GetCollectionItemsService(store, new FakeItemImageStorage());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.GetAsync(17, 9, cursor: null, limit: 50));
    }

    [Fact]
    public async Task GetAsync_WhenStoreReturnsNextCursor_PropagatesItToResult()
    {
        var nextCursor = new CollectionItemPageCursor(512, 7);
        var store = new FakeCollectionItemStore { NextCursor = nextCursor };
        var service = new GetCollectionItemsService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, 9, cursor: null, limit: 50);

        Assert.Equal(nextCursor, result.NextCursor);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasRepresentativeImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/img.jpg?sas=1");
        var items = new List<CollectionItemEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, 0, null, null, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeCollectionItemStore
        {
            Items = items,
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetCollectionItemsService(store, imageStorage);

        var result = await service.GetAsync(17, 9, cursor: null, limit: 50);

        Assert.Equal(new RepresentativeImageDto(9, readUrl), result.Items[0].RepresentativeImage);
        Assert.Equal((17L, "items/17/41/img.jpg"), imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasNoImage_RepresentativeImageIsNull()
    {
        var items = new List<CollectionItemEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, 0, null, null, null),
        };
        var store = new FakeCollectionItemStore { Items = items };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetCollectionItemsService(store, imageStorage);

        var result = await service.GetAsync(17, 9, cursor: null, limit: 50);

        Assert.Null(result.Items[0].RepresentativeImage);
        Assert.Null(imageStorage.LastCreateReadUrlCall);
    }

    /// <summary>
    /// Regression coverage for the Category-thumbnail bug: CoverImage must resolve to a signed read
    /// URL the same way RepresentativeImage does, not stay null just because it's a different
    /// dictionary/priority level (see resolveEffectiveThumbnailUrl on the Mobile side, which prefers
    /// CoverImage over RepresentativeImage).
    /// </summary>
    [Fact]
    public async Task GetAsync_WhenItemHasCoverImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/cover.jpg?sas=1");
        var items = new List<CollectionItemEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, 0, null, null, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 12, BlobName: "items/17/41/cover.jpg");
        var store = new FakeCollectionItemStore
        {
            Items = items,
            CoverImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetCollectionItemsService(store, imageStorage);

        var result = await service.GetAsync(17, 9, cursor: null, limit: 50);

        Assert.Equal(new RepresentativeImageDto(12, readUrl), result.Items[0].CoverImage);
    }

    /// <summary>PreviewImageUrl is an external URL already fully populated by the store - unlike RepresentativeImage/CoverImage it never goes through IItemImageStorage.</summary>
    [Fact]
    public async Task GetAsync_WhenItemHasPreviewImageUrl_PropagatesThroughUnchanged()
    {
        var items = new List<CollectionItemEntryDto>
        {
            new(41, "https://example.test/item", null, null, DateTimeOffset.UtcNow, 0, null,
                "https://cdn.example/preview.jpg", null),
        };
        var store = new FakeCollectionItemStore { Items = items };
        var service = new GetCollectionItemsService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, 9, cursor: null, limit: 50);

        Assert.Equal("https://cdn.example/preview.jpg", result.Items[0].PreviewImageUrl);
    }

    private sealed class FakeCollectionItemStore : ICollectionItemStore
    {
        public bool ThrowNotFound { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public CollectionItemPageCursor? LastCursor { get; private set; }

        public int? LastLimit { get; private set; }

        public IReadOnlyList<CollectionItemEntryDto> Items { get; init; } = [];

        public CollectionItemPageCursor? NextCursor { get; init; }

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
            long userId,
            long collectionId,
            CollectionItemPageCursor? cursor,
            int limit,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastCursor = cursor;
            LastLimit = limit;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            return Task.FromResult((new CollectionItemPage(Items, NextCursor), RepresentativeImages, CoverImages));
        }

        public Task AddAsync(
            long userId, long collectionId, long itemId, DateTimeOffset addedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetCollectionItemsService tests.");

        public Task RemoveAsync(
            long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetCollectionItemsService tests.");

        public Task MoveItemAsync(
            long userId, long collectionId, long itemId, long? afterItemId,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetCollectionItemsService tests.");
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
