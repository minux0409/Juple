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
        CreateImage(SKEncodedImageFormat.Jpeg, 2, 2).CopyTo(tooLargeContent, 0);

        await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, tooLargeContent));

        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenValidImageIsPaddedToExactly10Megabytes_StillSucceeds()
    {
        var source = CreateImage(SKEncodedImageFormat.Jpeg, 4, 3);
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
            17, 41, CreateImage(sourceFormat, 900, 600));

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        AssertWebP(normalized.MainContent, 900, 600);
        AssertWebP(normalized.ThumbnailContent, 512, 341);
        Assert.Equal((900, 600), (normalized.MainWidth, normalized.MainHeight));
        Assert.Equal((512, 341), (normalized.ThumbnailWidth, normalized.ThumbnailHeight));
    }

    [Fact]
    public async Task UploadAsync_LargeLandscape_PreservesAspectRatioAndBoundsBothVariants()
    {
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(
            17, 41, CreateImage(SKEncodedImageFormat.Jpeg, 3000, 1000));

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        // JPEG's native scaled decode chooses its nearest efficient 1/2 step (1500px), still under
        // the 1600px bound without allocating the 3000px source bitmap.
        Assert.Equal((1500, 500), (normalized.MainWidth, normalized.MainHeight));
        Assert.Equal((512, 171), (normalized.ThumbnailWidth, normalized.ThumbnailHeight));
        Assert.InRange(Math.Abs((double)normalized.MainWidth / normalized.MainHeight - 3), 0, 0.01);
    }

    [Fact]
    public async Task UploadAsync_AppliesPortraitExifOrientationAndStripsMetadata()
    {
        var source = AddExifOrientation(CreateImage(SKEncodedImageFormat.Jpeg, 80, 40), orientation: 6);
        Assert.True(ContainsAscii(source, "Exif"));
        var store = new FakeItemImageStore();

        await new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, source);

        var normalized = Assert.IsType<NormalizedItemImage>(store.LastImage);
        Assert.Equal((40, 80), (normalized.MainWidth, normalized.MainHeight));
        Assert.False(ContainsAscii(normalized.MainContent, "Exif"));
        Assert.False(ContainsAscii(normalized.ThumbnailContent, "Exif"));
    }

    [Fact]
    public async Task UploadAsync_WhenDimensionsExceedSafeEdge_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();
        var source = CreateImage(SKEncodedImageFormat.Png, ItemImageNormalizer.MaxInputEdge + 1, 1);

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(
            () => new UploadItemImageService(store, new FixedTimeProvider()).UploadAsync(17, 41, source));

        Assert.Contains("dimensions", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(store.WasUploadCalled);
    }

    [Fact]
    public async Task UploadAsync_WhenPixelCountExceedsSafeLimit_RejectsBeforeStoreCall()
    {
        var store = new FakeItemImageStore();
        var source = CreateImage(SKEncodedImageFormat.Png, 6_000, 6_000);

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
            17, 41, CreateImage(SKEncodedImageFormat.Jpeg, 10, 10));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Equal(fixedTime, store.LastCreatedAtUtc);
    }

    private static byte[] CreateImage(SKEncodedImageFormat format, int width, int height)
    {
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(new SKColor(242, 244, 248));
            using var paint = new SKPaint { Color = new SKColor(18, 80, 180), IsAntialias = true };
            canvas.DrawRect(0, 0, Math.Max(1, width / 2f), height, paint);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, 92) ?? throw new InvalidOperationException("Test image encode failed.");
        return data.ToArray();
    }

    private static void AssertWebP(byte[] content, int width, int height)
    {
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(content, 0, 4));
        Assert.Equal("WEBP", System.Text.Encoding.ASCII.GetString(content, 8, 4));
        using var bitmap = SKBitmap.Decode(content);
        Assert.NotNull(bitmap);
        Assert.Equal((width, height), (bitmap.Width, bitmap.Height));
    }

    private static byte[] AddExifOrientation(byte[] jpeg, ushort orientation)
    {
        byte[] app1 =
        [
            0xFF, 0xE1, 0x00, 0x22,
            0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
            0x00, 0x01,
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
            (byte)(orientation >> 8), (byte)orientation, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ];
        return [.. jpeg[..2], .. app1, .. jpeg[2..]];
    }

    private static bool ContainsAscii(byte[] content, string value) =>
        System.Text.Encoding.ASCII.GetString(content).Contains(value, StringComparison.Ordinal);

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
