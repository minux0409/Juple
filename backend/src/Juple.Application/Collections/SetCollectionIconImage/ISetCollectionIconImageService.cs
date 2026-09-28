namespace Juple.Application.Collections.SetCollectionIconImage;

public interface ISetCollectionIconImageService
{
    /// <summary>
    /// Owner only (the caller's permission filter enforces it; the store re-checks ownership).
    /// Replaces any previous photo - the old Blob is deleted after the new one is saved.
    /// Throws InvalidItemImageException for a missing/oversized/unsupported file.
    /// </summary>
    Task<CollectionDto> UploadAsync(long userId, long collectionId, byte[]? content, CancellationToken cancellationToken = default);

    /// <summary>Back to the built-in icon; idempotent when there is no photo.</summary>
    Task<CollectionDto> RemoveAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
