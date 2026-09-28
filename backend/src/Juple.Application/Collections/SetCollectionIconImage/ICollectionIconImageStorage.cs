using Juple.Application.Images;

namespace Juple.Application.Collections.SetCollectionIconImage;

/// <summary>
/// Blob operations for a Collection's icon photo - the same container, naming root and signing as
/// Item images (see IItemImageStorage), so nothing new is provisioned: the Blob lives under the
/// Owner's own prefix ("items/{ownerUserId}/collections/{collectionId}/..."), which account
/// deletion's prefix cleanup already removes.
/// </summary>
public interface ICollectionIconImageStorage
{
    /// <summary>Uploads the (already format-verified) bytes and returns the new Blob's name.</summary>
    Task<string> UploadCollectionIconAsync(
        long ownerUserId,
        long collectionId,
        ImageFormat format,
        byte[] content,
        CancellationToken cancellationToken = default);

    /// <summary>Best-effort, never throws; only ever deletes a Blob under this Owner's collection-icon prefix.</summary>
    Task DeleteCollectionIconAsync(
        long ownerUserId,
        string blobName,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A short-lived read URL for the Owner's icon photo, for anyone the caller already allowed to
    /// see the Collection (Owner or member). Null when it could not be generated - the client then
    /// shows the built-in icon.
    /// </summary>
    Task<Uri?> CreateCollectionIconReadUrlAsync(
        long ownerUserId,
        string blobName,
        CancellationToken cancellationToken = default);
}
