using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemDetail;
using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class GetItemDetailServiceTests
{
    [Fact]
    public async Task GetAsync_WhenItemExists_ReturnsDetails()
    {
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", "My Title", "My memo", DateTimeOffset.UtcNow,
            ItemState.Wishlist, DateTimeOffset.UtcNow, new ItemCategoryDto(9, "Electronics"), null);
        var store = new FakeItemDetailQueryStore { Details = expected };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(expected, result);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
    }

    [Fact]
    public async Task GetAsync_WhenItemDoesNotExist_ThrowsItemNotFoundException()
    {
        var store = new FakeItemDetailQueryStore { Details = null };
        var service = new GetItemDetailService(store, new FakeItemImageStorage());

        await Assert.ThrowsAsync<ItemNotFoundException>(() => service.GetAsync(17, 41));
    }

    [Fact]
    public async Task GetAsync_WhenItemHasRepresentativeImage_ResolvesReadUrl()
    {
        var readUrl = new Uri("https://storage.example/items/17/41/img.jpg?sas=1");
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow,
            ItemState.Wishlist, DateTimeOffset.UtcNow, null, null);
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemDetailQueryStore { Details = expected, RepresentativeImage = reference };
        var imageStorage = new FakeItemImageStorage { ReadUrl = readUrl };
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(new RepresentativeImageDto(9, readUrl), result.RepresentativeImage);
        Assert.Equal((17L, "items/17/41/img.jpg"), imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasNoImage_RepresentativeImageIsNull()
    {
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow,
            ItemState.Wishlist, DateTimeOffset.UtcNow, null, null);
        var store = new FakeItemDetailQueryStore { Details = expected };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Null(result.RepresentativeImage);
        Assert.Null(imageStorage.LastCreateReadUrlCall);
    }

    [Fact]
    public async Task GetAsync_WhenReadUrlCreationFails_RepresentativeImageIsNullButRequestStillSucceeds()
    {
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow,
            ItemState.Wishlist, DateTimeOffset.UtcNow, null, null);
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemDetailQueryStore { Details = expected, RepresentativeImage = reference };
        var imageStorage = new FakeItemImageStorage { ReadUrl = null };
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Null(result.RepresentativeImage);
    }

    private sealed class FakeItemDetailQueryStore : IItemDetailQueryStore
    {
        public ItemDetailsDto? Details { get; init; }

        public ItemRepresentativeImageRef? RepresentativeImage { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage)> GetDetailsAsync(
            long userId,
            long itemId,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            return Task.FromResult((Details, RepresentativeImage));
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
