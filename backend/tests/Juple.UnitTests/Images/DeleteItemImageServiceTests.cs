using Juple.Application.Images;
using Juple.Application.Images.DeleteItemImage;

namespace Juple.UnitTests.Images;

public sealed class DeleteItemImageServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserItemAndImage()
    {
        var store = new FakeItemImageStore();
        var service = new DeleteItemImageService(store);

        await service.DeleteAsync(17, 41, 9);

        Assert.Equal((17L, 41L, 9L), store.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var store = new FakeItemImageStore();
        var service = new DeleteItemImageService(store);

        await service.DeleteAsync(17, 41, 9);
        await service.DeleteAsync(17, 41, 9);

        Assert.Equal(2, store.DeleteCallCount);
    }

    private sealed class FakeItemImageStore : IItemImageStore
    {
        public int DeleteCallCount { get; private set; }

        public (long UserId, long ItemId, long ImageId)? LastDeleteCall { get; private set; }

        public Task<IReadOnlyList<ItemImageDto>> ListAsync(
            long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ItemImageDto>>([]);

        public Task<ItemImageDto> UploadAsync(
            long userId,
            long itemId,
            ImageFormat format,
            byte[] content,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new ItemImageDto(1, "image/jpeg", content.LongLength, 0, createdAtUtc, ReadUrl: null));

        public Task DeleteAsync(long userId, long itemId, long imageId, CancellationToken cancellationToken = default)
        {
            DeleteCallCount++;
            LastDeleteCall = (userId, itemId, imageId);
            return Task.CompletedTask;
        }

    }
}
