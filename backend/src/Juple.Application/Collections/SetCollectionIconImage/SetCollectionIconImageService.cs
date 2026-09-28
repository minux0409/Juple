using Juple.Application.Images;

namespace Juple.Application.Collections.SetCollectionIconImage;

public sealed class SetCollectionIconImageService(
    ICollectionStore collectionStore,
    ICollectionIconImageStorage iconImageStorage,
    TimeProvider timeProvider) : ISetCollectionIconImageService
{
    /// <summary>
    /// An icon is shown at most a few dozen dp wide - the app resizes before uploading (512px), so
    /// this is only a backstop against misuse, well under the Item image limit.
    /// </summary>
    public const long MaxByteLength = 5 * 1024 * 1024;

    public async Task<CollectionDto> UploadAsync(
        long userId,
        long collectionId,
        byte[]? content,
        CancellationToken cancellationToken = default)
    {
        if (content is null || content.Length == 0)
        {
            throw new InvalidItemImageException("file", "An image file is required.");
        }

        if (content.LongLength > MaxByteLength)
        {
            throw new InvalidItemImageException("file", "Image must be 5MB or smaller.");
        }

        // Only the file's own bytes decide the format - never a client-supplied type or name.
        var format = ImageFormatDetector.Detect(content)
            ?? throw new InvalidItemImageException("file", "Only JPEG, PNG, or WebP images are allowed.");

        var blobName = await iconImageStorage.UploadCollectionIconAsync(userId, collectionId, format, content, cancellationToken);
        (CollectionDto Collection, string? ReplacedBlobName) result;
        try
        {
            result = await collectionStore.SetIconImageAsync(userId, collectionId, blobName, timeProvider.GetUtcNow(), cancellationToken);
        }
        catch
        {
            // Not saved (not found, not the Owner's, concurrent change): the new Blob is an orphan.
            await iconImageStorage.DeleteCollectionIconAsync(userId, blobName, CancellationToken.None);
            throw;
        }

        if (result.ReplacedBlobName is { } replaced)
        {
            await iconImageStorage.DeleteCollectionIconAsync(userId, replaced, CancellationToken.None);
        }

        return result.Collection;
    }

    public async Task<CollectionDto> RemoveAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        var (collection, replaced) = await collectionStore.SetIconImageAsync(
            userId, collectionId, null, timeProvider.GetUtcNow(), cancellationToken);
        if (replaced is not null)
        {
            await iconImageStorage.DeleteCollectionIconAsync(userId, replaced, CancellationToken.None);
        }

        return collection;
    }
}
