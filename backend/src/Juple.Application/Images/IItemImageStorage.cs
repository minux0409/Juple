namespace Juple.Application.Images;

/// <summary>
/// Raw Blob storage operations for Item images, independent of the SQL row (see
/// <see cref="IItemImageStore"/> for that). Kept separate so cross-module callers that only need
/// to clean up an Item's Blobs - e.g. Items' DeleteItemService after an Item delete - depend on a
/// contract with no ownership/DB semantics attached to it, and never assemble raw Azure naming
/// conventions themselves.
/// </summary>
public interface IItemImageStorage
{
    /// <summary>
    /// Best-effort: deletes every Blob stored for this Item (found by listing the Item's own Blob
    /// path prefix - never a caller-supplied snapshot of names, which could miss a Blob uploaded
    /// after the snapshot was taken), never throws, and logs a sanitized structured warning per
    /// failure (no credential/SAS/token content). Only ever touches Blobs under userId/itemId's
    /// own prefix, so it cannot reach another user's data regardless of what itemId is passed.
    /// </summary>
    Task DeleteItemBlobsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
