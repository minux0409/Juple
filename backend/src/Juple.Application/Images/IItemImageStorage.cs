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

    /// <summary>
    /// The canonical Blob Storage prefix for everything this user owns ("items/{userId}/") - the
    /// single source of truth for this naming convention (UploadAsync/DeleteItemBlobsAsync derive
    /// from the same format). Pure, no I/O - lets other modules (e.g. account deletion) durably
    /// record a prefix to clean up later (see AccountDeletionBlobCleanup) without assembling raw
    /// Azure path syntax themselves.
    /// </summary>
    string GetUserBlobPrefix(long userId);

    /// <summary>
    /// Best-effort: deletes every Blob under the given prefix (found by listing Blob Storage
    /// directly, never a caller-supplied snapshot of names), logging a sanitized structured
    /// warning per failure, and never throwing. Returns whether every Blob found under the prefix
    /// was confirmed deleted - false if enumeration itself failed, or any individual Blob delete
    /// failed. Callers that need a durable guarantee (see IBlobCleanupService) use this return
    /// value to decide whether cleanup can be considered complete or must be retried later.
    /// </summary>
    Task<bool> DeleteBlobsByPrefixAsync(
        string prefix,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A read-only, short-lived URL for the Blob at blobName - a SAS in Production (Managed
    /// Identity + User Delegation Key) and on Azurite locally (Shared Key). Verifies blobName is
    /// scoped to userId's own path before signing, so a caller can never obtain a URL for another
    /// user's Blob even by mistake. Never persisted; generated fresh on every call. Returns null
    /// rather than throwing when the URL could not be generated - the caller decides how to
    /// degrade (see callers for the chosen failure policy).
    /// </summary>
    Task<Uri?> CreateReadUrlAsync(
        long userId,
        string blobName,
        CancellationToken cancellationToken = default);
}
