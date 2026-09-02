namespace Juple.Application.Images;

public interface IItemImageStore
{
    /// <summary>Throws ItemNotFoundException if the Item does not exist or is not owned by userId.</summary>
    Task<IReadOnlyList<ItemImageDto>> ListAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Callers must pass already-validated format/content (size, magic-byte format already
    /// checked) - this method trusts them and only enforces ownership and the per-Item image cap.
    /// Uploads the Blob before inserting the row; if the DB insert fails, the just-uploaded Blob
    /// is deleted best-effort before the original exception is rethrown.
    /// </summary>
    Task<ItemImageDto> UploadAsync(
        long userId,
        long itemId,
        ImageFormat format,
        byte[] content,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A missing/other-user Item or a missing image is treated as already deleted and completes
    /// without error. The Blob is deleted best-effort after the DB row is removed.
    /// </summary>
    Task DeleteAsync(
        long userId,
        long itemId,
        long imageId,
        CancellationToken cancellationToken = default);
}
