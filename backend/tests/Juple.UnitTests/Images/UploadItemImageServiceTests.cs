using Juple.Application.Images;
using Juple.Application.Images.UploadItemImage;
using SkiaSharp;

namespace Juple.UnitTests.Images;

public sealed class UploadItemImageServiceTests
{
    [Fact]
    public async Task UploadAsync_WhenContentIsNullOrEmpty_ThrowsWithoutStoreCall()
    {
        foreach (var content in new byte[]?[] { null, [] })
        {
            var store = new FakeItemImageStore();
            var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
                () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, content));
            Assert.Equal("file", exception.Field);
            Assert.False(store.WasUploadCalled);
        }
    }

    [Fact]
    public async Task UploadAsync_WhenContentExceeds10Megabytes_ThrowsBeforeDecode()
    {
        var store = new FakeItemImageStore();
        var tooLargeContent = new byte[10 * 1024 * 1024 + 1];
        TestImages.Create(SKEncodedImageFormat.Jpeg, 2, 2).CopyTo(tooLargeContent, 0);

        await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, tooLargeContent));

        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenValidImageIsPaddedToExactly10Megabytes_StillSucceeds()
    {
        var source = TestImages.Create(SKEncodedImageFormat.Jpeg, 4, 3);
        var maxSizeContent = new byte[10 * 1024 * 1024];
        source.CopyTo(maxSizeContent, 0);
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, maxSizeContent);

        Assert.True(store.WasUploadCalled);
    }

    [Theory]
    [InlineData(SKEncodedImageFormat.Jpeg)]
    [InlineData(SKEncodedImageFormat.Png)]
    [InlineData(SKEncodedImageFormat.Webp)]
    public async Task UploadAsync_NormalizesSupportedFormatsToWebPWithThumbnail(SKEncodedImageFormat sourceFormat)
    {
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(
            17, 41, TestImages.Create(sourceFormat, 900, 600));

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        TestImages.AssertWebP(normalized.MainContent, 900, 600);
        TestImages.AssertWebP(normalized.ThumbnailContent, 512, 341);
        Assert.Equal((900, 600), (normalized.MainWidth, normalized.MainHeight));
        Assert.Equal((512, 341), (normalized.ThumbnailWidth, normalized.ThumbnailHeight));
    }

    [Fact]
    public async Task UploadAsync_LargeLandscape_PreservesAspectRatioAndBoundsBothVariants()
    {
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(
            17, 41, TestImages.Create(SKEncodedImageFormat.Jpeg, 3000, 1000));

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        // JPEG decodes at the smallest native step still covering 1600px (5/8 = 1875px - never the 3000px
        // source bitmap), then the resize lands exactly on the 1600px bound.
        Assert.Equal((1600, 533), (normalized.MainWidth, normalized.MainHeight));
        Assert.Equal((512, 171), (normalized.ThumbnailWidth, normalized.ThumbnailHeight));
        Assert.InRange(Math.Abs((double)normalized.MainWidth / normalized.MainHeight - 3), 0, 0.01);
    }

    [Fact]
    public async Task UploadAsync_AppliesPortraitExifOrientationAndStripsMetadata()
    {
        var source = TestImages.AddExifOrientation(TestImages.Create(SKEncodedImageFormat.Jpeg, 80, 40), orientation: 6);
        Assert.True(TestImages.ContainsAscii(source, "Exif"));
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, source);

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        Assert.Equal((40, 80), (normalized.MainWidth, normalized.MainHeight));
        Assert.False(TestImages.ContainsAscii(normalized.MainContent, "Exif"));
        Assert.False(TestImages.ContainsAscii(normalized.ThumbnailContent, "Exif"));
    }

    [Fact]
    public async Task UploadAsync_WhenDimensionsExceedSafeEdge_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();
        var source = TestImages.Create(SKEncodedImageFormat.Png, ItemImageNormalizer.MaxInputEdge + 1, 1);

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, source));

        Assert.Contains("dimensions", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenPixelCountExceedsSafeLimit_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();
        var source = TestImages.Create(SKEncodedImageFormat.Png, 6_000, 6_000);

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, source));

        Assert.Contains("dimensions", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenRecognizedHeaderIsCorrupt_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();
        var corrupt = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 0x02, 0x03 };

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, corrupt));

        Assert.Contains("invalid or corrupt", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenFormatIsUnsupported_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();

        await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, "GIF89a"u8.ToArray()));

        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_UsesOwnerItemAndTimeProvider()
    {
        var store = new FakeItemImageStore();
        var fixedTime = new DateTimeOffset(2026, 9, 2, 10, 0, 0, TimeSpan.Zero);

        await new UploadItemImageService(store, new FixedTimeProvider(fixedTime)).UploadAsync(
            17, 41, TestImages.Create(SKEncodedImageFormat.Jpeg, 10, 10));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Equal(fixedTime, store.LastCreatedAtUtc);
    }

    private sealed class FakeItemImageStore : IItemImageStore
    {
        public bool WasUploadCalled { get; private set; }
        public long? LastUserId { get; private set; }
        public long? LastItemId { get; private set; }
        public NormalizedItemImage? LastImage { get; private set; }
        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<IReadOnlyList<ItemImageDto>> ListAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ItemImageDto>>([]);

        public Task<ItemImageDto> UploadAsync(
            long userId,
            long itemId,
            NormalizedItemImage image,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasUploadCalled = true;
            LastUserId = userId;
            LastItemId = itemId;
            LastImage = image;
            LastCreatedAtUtc = createdAtUtc;
            return Task.FromResult(new ItemImageDto(1, NormalizedItemImage.ContentType, image.MainContent.LongLength, 0, createdAtUtc, ReadUrl: null));
        }

        public Task DeleteAsync(long userId, long itemId, long imageId, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero);
    }
}
