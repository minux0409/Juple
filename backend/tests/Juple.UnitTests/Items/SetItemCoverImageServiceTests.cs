using Juple.Application.Items;
using Juple.Application.Items.SetItemCoverImage;

namespace Juple.UnitTests.Items;

public sealed class SetItemCoverImageServiceTests
{
    [Fact]
    public async Task SetAsync_DelegatesImageIdToStore()
    {
        var store = new FakeItemDetailsStore();
        var service = new SetItemCoverImageService(store);

        await service.SetAsync(17, 41, new SetItemCoverImageCommand(9));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Equal(9, store.LastImageId);
    }

    [Fact]
    public async Task SetAsync_WithNullImageId_DelegatesNullToStore()
    {
        var store = new FakeItemDetailsStore { LastImageId = 5 };
        var service = new SetItemCoverImageService(store);

        await service.SetAsync(17, 41, new SetItemCoverImageCommand(null));

        Assert.Null(store.LastImageId);
    }

    [Fact]
    public async Task SetAsync_WhenStoreThrowsInvalidItemDetails_Propagates()
    {
        var store = new FakeItemDetailsStore { ThrowInvalid = true };
        var service = new SetItemCoverImageService(store);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.SetAsync(17, 41, new SetItemCoverImageCommand(9)));

        Assert.Equal("imageId", exception.Field);
    }

    [Fact]
    public async Task SetAsync_WhenItemNotFound_Propagates()
    {
        var store = new FakeItemDetailsStore { ThrowNotFound = true };
        var service = new SetItemCoverImageService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.SetAsync(17, 41, new SetItemCoverImageCommand(9)));
    }

    private sealed class FakeItemDetailsStore : IItemDetailsStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowInvalid { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public long? LastImageId { get; set; }

        public Task UpdateDetailsAsync(
            long userId, long itemId, string? title, string? memo, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task SetPreviewImageUrlAsync(
            long userId, long itemId, string previewImageUrl, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task SetCoverImageIdAsync(
            long userId, long itemId, long? imageId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            LastImageId = imageId;

            if (ThrowNotFound)
            {
                throw new ItemNotFoundException();
            }

            if (ThrowInvalid)
            {
                throw new InvalidItemDetailsException("imageId", "The image does not belong to this Item.");
            }

            return Task.CompletedTask;
        }
    }
}
