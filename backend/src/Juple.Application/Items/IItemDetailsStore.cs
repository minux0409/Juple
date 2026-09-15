namespace Juple.Application.Items;

public interface IItemDetailsStore
{
    /// <summary>
    /// Replaces the caller's Item's Title/Memo. Callers must pass already-normalized values.
    /// </summary>
    Task UpdateDetailsAsync(
        long userId,
        long itemId,
        string? title,
        string? memo,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the caller's Item's PreviewImageUrl. Callers must pass an already-validated
    /// absolute http/https URL - never user-uploaded ItemImages (see Juple.Domain.Images.ItemImage).
    /// </summary>
    Task SetPreviewImageUrlAsync(
        long userId,
        long itemId,
        string previewImageUrl,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets (imageId non-null) or clears (null) the caller's Item's explicit cover image choice.
    /// When non-null, throws InvalidItemDetailsException("imageId", ...) if imageId does not
    /// reference an existing ItemImage owned by this same Item - a cover can never point at
    /// another Item's (even the same user's) image.
    /// </summary>
    Task SetCoverImageIdAsync(
        long userId,
        long itemId,
        long? imageId,
        CancellationToken cancellationToken = default);
}
