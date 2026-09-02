using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemsByState;
using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class GetItemsByStateServiceTests
{
    [Fact]
    public async Task GetAsync_PassesThroughPageAndArguments()
    {
        var items = new List<ItemListEntryDto>
        {
            new(41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null),
        };
        var store = new FakeItemQueryStore { Page = new ItemPage(items, null) };
        var service = new GetItemsByStateService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, ItemState.Wishlist, categoryId: 5, cursor: null, limit: 20);

        Assert.Equal(items[0].Id, result.Items[0].Id);
        Assert.Equal((17L, ItemState.Wishlist, 5L), (store.LastUserId, store.LastState, store.LastCategoryId));
    }

    [Fact]
    public async Task GetAsync_WhenItemHasRepresentativeImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/img.jpg?sas=1");
        var items = new List<ItemListEntryDto>
        {
            new(41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemQueryStore
        {
            Page = new ItemPage(items, null),
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetItemsByStateService(store, imageStorage);

        var result = await service.GetAsync(17, ItemState.Wishlist, categoryId: null, cursor: null, limit: 20);

        Assert.Equal(new RepresentativeImageDto(9, readUrl), result.Items[0].RepresentativeImage);
        Assert.Equal((17L, "items/17/41/img.jpg"), imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasNoImage_RepresentativeImageIsNull()
    {
        var items = new List<ItemListEntryDto>
        {
            new(41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null),
        };
        var store = new FakeItemQueryStore { Page = new ItemPage(items, null) };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetItemsByStateService(store, imageStorage);

        var result = await service.GetAsync(17, ItemState.Wishlist, categoryId: null, cursor: null, limit: 20);

        Assert.Null(result.Items[0].RepresentativeImage);
        Assert.Null(imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenReadUrlCreationFails_RepresentativeImageIsNullButRequestStillSucceeds()
    {
        var items = new List<ItemListEntryDto>
        {
            new(41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null),
        };
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemQueryStore
        {
            Page = new ItemPage(items, null),
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef> { [41] = reference },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = null };
        var service = new GetItemsByStateService(store, imageStorage);

        var result = await service.GetAsync(17, ItemState.Wishlist, categoryId: null, cursor: null, limit: 20);

        Assert.Null(result.Items[0].RepresentativeImage);
    }

    [Fact]
    public async Task GetAsync_PreservesNextCursor()
    {
        var cursor = new ItemPageCursor(DateTimeOffset.UtcNow, 41);
        var store = new FakeItemQueryStore { Page = new ItemPage([], cursor) };
        var service = new GetItemsByStateService(store, new FakeItemImageStorage());

        var result = await service.GetAsync(17, ItemState.Wishlist, categoryId: null, cursor: null, limit: 20);

        Assert.Equal(cursor, result.NextCursor);
    }

    private sealed class FakeItemQueryStore : IItemQueryStore
    {
        public required ItemPage Page { get; init; }

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public long? LastUserId { get; private set; }

        public ItemState? LastState { get; private set; }

        public long? LastCategoryId { get; private set; }

        public Task<(ItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetByStateAsync(
            long userId,
            ItemState state,
            long? categoryId,
            ItemPageCursor? cursor,
            int limit,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastState = state;
            LastCategoryId = categoryId;
            return Task.FromResult((Page, RepresentativeImages));
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public Uri? ReadUrl { get; init; }

        public (long UserId, string BlobName)? LastCreateReadUrlCall { get; private set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            LastCreateReadUrlCall = (userId, blobName);
            return Task.FromResult(ReadUrl);
        }
    }
}
