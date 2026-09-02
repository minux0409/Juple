using Juple.Application.Images;
using Juple.Application.Images.UploadItemImage;

namespace Juple.UnitTests.Images;

public sealed class UploadItemImageServiceTests
{
    private static readonly byte[] JpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 0x02, 0x03];

    [Fact]
    public async Task UploadAsync_WhenContentIsNull_ThrowsInvalidItemImage()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => service.UploadAsync(17, 41, content: null));

        Assert.Equal("file", exception.Field);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenContentIsEmpty_ThrowsInvalidItemImage()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => service.UploadAsync(17, 41, content: []));

        Assert.Equal("file", exception.Field);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenContentExceeds10Megabytes_ThrowsInvalidItemImage()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());
        var tooLargeContent = new byte[10 * 1024 * 1024 + 1];
        JpegBytes.CopyTo(tooLargeContent, 0);

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => service.UploadAsync(17, 41, tooLargeContent));

        Assert.Equal("file", exception.Field);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenContentIsExactly10Megabytes_Succeeds()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());
        var maxSizeContent = new byte[10 * 1024 * 1024];
        JpegBytes.CopyTo(maxSizeContent, 0);

        await service.UploadAsync(17, 41, maxSizeContent);

        Assert.True(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenContentIsNotARecognizedImageFormat_ThrowsInvalidItemImage()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());
        var notAnImage = "this is not an image"u8.ToArray();

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => service.UploadAsync(17, 41, notAnImage));

        Assert.Equal("file", exception.Field);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenContentIsValidJpeg_CallsStoreWithDetectedFormat()
    {
        var store = new FakeItemImageStore();
        var service = new UploadItemImageService(store, new FixedTimeProvider());

        await service.UploadAsync(17, 41, JpegBytes);

        Assert.Equal(ImageFormat.Jpeg, store.LastFormat);
        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Same(JpegBytes, store.LastContent);
    }

    [Fact]
    public async Task UploadAsync_UsesTimeProviderForCreatedAtUtc()
    {
        var store = new FakeItemImageStore();
        var fixedTime = new DateTimeOffset(2026, 9, 2, 10, 0, 0, TimeSpan.Zero);
        var service = new UploadItemImageService(store, new FixedTimeProvider(fixedTime));

        await service.UploadAsync(17, 41, JpegBytes);

        Assert.Equal(fixedTime, store.LastCreatedAtUtc);
    }

    [Fact]
    public async Task UploadAsync_WhenItemLimitExceeded_PropagatesException()
    {
        var store = new FakeItemImageStore { ThrowLimitExceeded = true };
        var service = new UploadItemImageService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<ItemImageLimitExceededException>(
            () => service.UploadAsync(17, 41, JpegBytes));
    }

    private sealed class FakeItemImageStore : IItemImageStore
    {
        public bool ThrowLimitExceeded { get; init; }

        public bool WasUploadCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public ImageFormat? LastFormat { get; private set; }

        public byte[]? LastContent { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<IReadOnlyList<ItemImageDto>> ListAsync(
            long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ItemImageDto>>([]);

        public Task<ItemImageDto> UploadAsync(
            long userId,
            long itemId,
            ImageFormat format,
            byte[] content,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasUploadCalled = true;
            LastUserId = userId;
            LastItemId = itemId;
            LastFormat = format;
            LastContent = content;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowLimitExceeded)
            {
                throw new ItemImageLimitExceededException();
            }

            return Task.FromResult(new ItemImageDto(1, "image/jpeg", content.LongLength, 0, createdAtUtc));
        }

        public Task DeleteAsync(
            long userId, long itemId, long imageId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero);
    }
}
