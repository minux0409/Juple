using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemTrash;

namespace Juple.UnitTests.Items;

public sealed class GetItemTrashServiceTests
{
    [Fact]
    public async Task GetAsync_RequestsTheSingleFiftyItemListLimitFromStore_ForEveryUser()
    {
        var store = new FakeItemTrashQueryStore();
        var service = new GetItemTrashService(store, new FakeItemImageStorage());

        await service.GetAsync(17);

        Assert.Equal(50, ItemTrashLimits.ListLimit);
        Assert.Equal(ItemTrashLimits.ListLimit, store.LastLimit);
    }

    [Fact]
    public void ListLimit_NeverExceedsServerSideRetention()
    {
        Assert.True(ItemTrashLimits.ListLimit <= ItemTrashLimits.MaxRetainedPerUser);
    }

    [Fact]
    public async Task GetAsync_PassesCurrentUserIdToStore()
    {
        var store = new FakeItemTrashQueryStore();
        var service = new GetItemTrashService(store, new FakeItemImageStorage());

        await service.GetAsync(17);

        Assert.Equal(17, store.LastUserId);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasRepresentativeImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/img.jpg?sas=1");
        var items = new List<ItemTrashEntryDto>
        {
            new(41, "https://example.test/item", null, DateTimeOffset.UtcNow, null, null, null),
        };
        var store = new FakeItemTrashQueryStore
        {
            Items = items,
            RepresentativeImages = new Dictionary<long, ItemRepresentativeImageRef>
            {
                [41] = new ItemRepresentativeImageRef(9, "items/17/41/img.jpg"),
            },
        };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetItemTrashService(store, imageStorage);

        var result = await service.GetAsync(17);

        Assert.Equal(new RepresentativeImageDto(9, readUrl), result[0].RepresentativeImage);
    }

    private sealed class FakeItemTrashQueryStore : IItemTrashQueryStore
    {
        public long? LastUserId { get; private set; }

        public int? LastLimit { get; private set; }

        public IReadOnlyList<ItemTrashEntryDto> Items { get; init; } = [];

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages { get; init; } =
            new Dictionary<long, ItemRepresentativeImageRef>();

        public Task<(IReadOnlyList<ItemTrashEntryDto> Items, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> ListTrashAsync(
            long userId, int limit, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastLimit = limit;
            return Task.FromResult((Items, RepresentativeImages, CoverImages));
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public Uri? ReadUrl { get; init; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult(ReadUrl);
    }
}
