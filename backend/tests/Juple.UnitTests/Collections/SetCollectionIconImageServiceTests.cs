using Juple.Application.Collections;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Images;
using Juple.Domain.Collections;
using Juple.UnitTests.Images;
using SkiaSharp;

namespace Juple.UnitTests.Collections;

public sealed class SetCollectionIconImageServiceTests
{
    [Fact]
    public async Task OtherOwnersCollectionIsRejectedBeforeDecodeAndBlobUpload()
    {
        var store = new FakeCollectionStore { NotOwned = true };
        var storage = new FakeIconStorage();
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            new SetCollectionIconImageService(store, storage, TimeProvider.System).UploadAsync(17, 41, [0xff, 0xd8, 0xff, 0x00]));
        Assert.Empty(storage.Uploaded);
        Assert.False(store.WasCalled);
    }
    private static readonly byte[] JpegBytes = TestImages.Create(SKEncodedImageFormat.Jpeg, 40, 30);

    [Fact]
    public async Task Upload_StoresTheNewPhoto_ThenDeletesTheOneItReplaced()
    {
        var store = new FakeCollectionStore { ReplacedBlobName = "items/17/collections/41/old.jpg" };
        var storage = new FakeIconStorage();
        var service = new SetCollectionIconImageService(store, storage, TimeProvider.System);

        var result = await service.UploadAsync(17, 41, JpegBytes);

        var uploaded = Assert.Single(storage.Uploaded);
        Assert.Equal((17L, 41L, ImageFormat.WebP), (uploaded.Owner, uploaded.CollectionId, uploaded.Format));
        TestImages.AssertWebP(uploaded.Content, 40, 30);
        Assert.Equal(uploaded.BlobName, store.LastBlobName);
        Assert.Equal(["items/17/collections/41/old.jpg"], storage.Deleted);
        Assert.Equal(41, result.Id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(new byte[0])]
    [InlineData(new byte[] { 0x01, 0x02, 0x03, 0x04 })]
    public async Task Upload_RejectsAMissingOrNonImageFile_WithoutTouchingStorage(byte[]? content)
    {
        var store = new FakeCollectionStore();
        var storage = new FakeIconStorage();
        var service = new SetCollectionIconImageService(store, storage, TimeProvider.System);

        var exception = await Assert.ThrowsAsync<InvalidItemImageException>(() => service.UploadAsync(17, 41, content));

        Assert.Equal("file", exception.Field);
        Assert.Empty(storage.Uploaded);
        Assert.Null(store.LastBlobName);
    }

    [Fact]
    public async Task Upload_StoresOneMetadataFreeOrientedWebP_WithinTheSmallImageBound()
    {
        // A landscape camera-style JPEG whose EXIF says "rotate 90" and carries a synthetic GPS location.
        var source = TestImages.AddExifWithGps(TestImages.Create(SKEncodedImageFormat.Jpeg, 2000, 1000), orientation: 6);
        Assert.True(TestImages.ContainsAscii(source, TestImages.MetadataMarker));
        var storage = new FakeIconStorage();

        await new SetCollectionIconImageService(new FakeCollectionStore(), storage, TimeProvider.System).UploadAsync(17, 41, source);

        var uploaded = Assert.Single(storage.Uploaded);
        Assert.Equal(ImageFormat.WebP, uploaded.Format);
        TestImages.AssertWebP(uploaded.Content, 256, 512); // rotated to portrait, longest edge capped at 512
        Assert.False(TestImages.ContainsAscii(uploaded.Content, "Exif"));
        Assert.False(TestImages.ContainsAscii(uploaded.Content, TestImages.MetadataMarker));
    }

    [Fact]
    public async Task Upload_RejectsHugeDeclaredDimensions_AndACorruptImage_WithoutTouchingStorage()
    {
        var storage = new FakeIconStorage();
        var service = new SetCollectionIconImageService(new FakeCollectionStore(), storage, TimeProvider.System);
        var pixelBomb = TestImages.Create(SKEncodedImageFormat.Png, ItemImageNormalizer.MaxInputEdge + 1, 1);
        var truncated = JpegBytes[..(JpegBytes.Length / 2)];

        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.UploadAsync(17, 41, pixelBomb));
        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.UploadAsync(17, 41, truncated));
        Assert.Empty(storage.Uploaded);
    }

    [Fact]
    public async Task Upload_RejectsAnOversizedFile()
    {
        var service = new SetCollectionIconImageService(new FakeCollectionStore(), new FakeIconStorage(), TimeProvider.System);
        byte[] tooLarge = [0xFF, 0xD8, 0xFF, .. new byte[SetCollectionIconImageService.MaxByteLength]];

        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.UploadAsync(17, 41, tooLarge));
    }

    [Fact]
    public async Task Upload_WhenTheRowIsNotSaved_DeletesTheJustUploadedBlob_AndRethrows()
    {
        var store = new FakeCollectionStore { ThrowNotFound = true };
        var storage = new FakeIconStorage();
        var service = new SetCollectionIconImageService(store, storage, TimeProvider.System);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.UploadAsync(17, 41, JpegBytes));

        Assert.Equal([Assert.Single(storage.Uploaded).BlobName], storage.Deleted);
    }

    [Fact]
    public async Task Remove_ClearsThePhoto_AndDeletesItsBlob_IdempotentWhenThereIsNone()
    {
        var store = new FakeCollectionStore { ReplacedBlobName = "items/17/collections/41/old.jpg" };
        var storage = new FakeIconStorage();
        var service = new SetCollectionIconImageService(store, storage, TimeProvider.System);

        await service.RemoveAsync(17, 41);
        Assert.True(store.WasCalled);
        Assert.Null(store.LastBlobName);
        Assert.Equal(["items/17/collections/41/old.jpg"], storage.Deleted);

        var noPhoto = new FakeCollectionStore();
        var noPhotoStorage = new FakeIconStorage();
        await new SetCollectionIconImageService(noPhoto, noPhotoStorage, TimeProvider.System).RemoveAsync(17, 41);
        Assert.Empty(noPhotoStorage.Deleted);
    }

    private sealed class FakeIconStorage : ICollectionIconImageStorage
    {
        public List<(long Owner, long CollectionId, ImageFormat Format, string BlobName, byte[] Content)> Uploaded { get; } = [];

        public List<string> Deleted { get; } = [];

        public Task<string> UploadCollectionIconAsync(long ownerUserId, long collectionId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default)
        {
            var blobName = $"items/{ownerUserId}/collections/{collectionId}/{Guid.NewGuid():N}.webp";
            Uploaded.Add((ownerUserId, collectionId, format, blobName, content));
            return Task.FromResult(blobName);
        }

        public Task DeleteCollectionIconAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default)
        {
            Deleted.Add(blobName);
            return Task.CompletedTask;
        }

        public Task<Uri?> CreateCollectionIconReadUrlAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool NotOwned { get; init; }
        public Task EnsureOwnedAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            NotOwned ? throw new CollectionNotFoundException() : Task.CompletedTask;
        public bool ThrowNotFound { get; init; }

        public string? ReplacedBlobName { get; init; }

        public bool WasCalled { get; private set; }

        public string? LastBlobName { get; private set; }

        public Task<(CollectionDto Collection, string? ReplacedBlobName)> SetIconImageAsync(
            long userId, long collectionId, string? blobName, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            LastBlobName = blobName;
            return Task.FromResult((new CollectionDto(collectionId, "Trip", false, 0, updatedAtUtc, updatedAtUtc, "Folder", null), ReplacedBlobName));
        }

        public Task<CollectionPage> ListAsync(long userId, long? itemId, long? excludeItemId, bool? isFavorite, CollectionPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionDto> CreateAsync(long userId, string name, string nameNormalized, CollectionIcon icon, DateTimeOffset createdAtUtc, string? color = null, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task RenameAsync(long userId, long collectionId, string name, string nameNormalized, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionDto> SetFavoriteAsync(long userId, long collectionId, bool isFavorite, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionDto> SetIconAsync(long userId, long collectionId, CollectionIcon icon, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionDto> SetColorAsync(long userId, long collectionId, string color, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
