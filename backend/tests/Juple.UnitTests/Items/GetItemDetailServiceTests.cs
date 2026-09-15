using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemDetail;

namespace Juple.UnitTests.Items;

public sealed class GetItemDetailServiceTests
{
    [Fact]
    public async Task GetAsync_WhenItemExists_ReturnsDetails()
    {
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", "My Title", "My memo", DateTimeOffset.UtcNow, null,
            PreviewImageUrl: "https://cdn.example.com/preview.jpg", CoverImage: null);
        var store = new FakeItemDetailQueryStore { Details = expected };
        var imageStorage = new FakeItemImageStorage();
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(expected, result);
        Assert.Equal("https://cdn.example.com/preview.jpg", result.PreviewImageUrl);
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
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, null, PreviewImageUrl: null, CoverImage: null);
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
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, null, PreviewImageUrl: null, CoverImage: null);
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
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, null, PreviewImageUrl: null, CoverImage: null);
        var reference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/img.jpg");
        var store = new FakeItemDetailQueryStore { Details = expected, RepresentativeImage = reference };
        var imageStorage = new FakeItemImageStorage { ReadUrl = null };
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Null(result.RepresentativeImage);
    }

    [Fact]
    public async Task GetAsync_WhenItemHasCoverImage_ResolvesReadUrlIndependentlyOfRepresentativeImage()
    {
        var repRead = new Uri("https://storage.example/items/17/41/first.jpg?sas=1");
        var coverRead = new Uri("https://storage.example/items/17/41/chosen.jpg?sas=1");
        var expected = new ItemDetailsDto(
            41, "https://shop.example/item", null, null, DateTimeOffset.UtcNow, null, PreviewImageUrl: null, CoverImage: null);
        var repReference = new ItemRepresentativeImageRef(ImageId: 9, BlobName: "items/17/41/first.jpg");
        var coverReference = new ItemRepresentativeImageRef(ImageId: 12, BlobName: "items/17/41/chosen.jpg");
        var store = new FakeItemDetailQueryStore
        {
            Details = expected,
            RepresentativeImage = repReference,
            CoverImage = coverReference,
        };
        var imageStorage = new FakeItemImageStorage { ReadUrlsByBlobName = { ["items/17/41/first.jpg"] = repRead, ["items/17/41/chosen.jpg"] = coverRead } };
        var service = new GetItemDetailService(store, imageStorage);

        var result = await service.GetAsync(17, 41);

        Assert.Equal(new RepresentativeImageDto(9, repRead), result.RepresentativeImage);
        Assert.Equal(new RepresentativeImageDto(12, coverRead), result.CoverImage);
    }

    private sealed class FakeItemDetailQueryStore : IItemDetailQueryStore
    {
        public ItemDetailsDto? Details { get; init; }

        public ItemRepresentativeImageRef? RepresentativeImage { get; init; }

        public ItemRepresentativeImageRef? CoverImage { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage, ItemRepresentativeImageRef? CoverImage)> GetDetailsAsync(
            long userId,
            long itemId,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            return Task.FromResult((Details, RepresentativeImage, CoverImage));
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public Uri? ReadUrl { get; init; }

        /// <summary>When set, takes priority over the single ReadUrl - lets a test give different
        /// blobs different resolved URLs (see the cover-vs-representative independence test).</summary>
        public Dictionary<string, Uri> ReadUrlsByBlobName { get; } = new();

        public (long UserId, string BlobName)? LastCreateReadUrlCall { get; private set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            LastCreateReadUrlCall = (userId, blobName);
            var resolved = ReadUrlsByBlobName.TryGetValue(blobName, out var mapped) ? mapped : ReadUrl;
            return Task.FromResult(resolved);
        }
    }
}
