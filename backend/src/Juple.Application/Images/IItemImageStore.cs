namespace Juple.Application.Images;

public interface IItemImageStore
{
    /// <summary>Throws ItemNotFoundException if the Item does not exist or is not owned by userId.</summary>
    Task<IReadOnlyList<ItemImageDto>> ListAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets the Item's one photo (its representative photo): an Item has at most one, so this
    /// replaces any previous one and makes the new one the cover. Callers must pass
    /// already-validated format/content (size, magic-byte format already checked) - this method
    /// trusts them and only enforces ownership. Uploads the Blob first; if the DB switch fails, the
    /// just-uploaded Blob is deleted best-effort, the previous photo stays, and the original
    /// exception is rethrown. The replaced Blobs are deleted only after the switch commits.
    /// </summary>
    Task<ItemImageDto> UploadAsync(
        long userId,
        long itemId,
        ImageFormat format,
        byte[] content,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes the Item's photo, leaving it with none (any extra row from when two were allowed goes
    /// too). A missing/other-user Item or a missing image is treated as already deleted and
    /// completes without error - and then touches nothing else. Blobs are deleted best-effort
    /// after the DB rows are removed.
    /// </summary>
    Task DeleteAsync(
        long userId,
        long itemId,
        long imageId,
        CancellationToken cancellationToken = default);
}
