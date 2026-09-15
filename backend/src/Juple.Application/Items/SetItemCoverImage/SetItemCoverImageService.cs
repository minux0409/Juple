namespace Juple.Application.Items.SetItemCoverImage;

/// <summary>
/// Sets or clears the Item's explicit cover image choice. Immediate persistence, independent of
/// the title/memo/category Save dirty-state - see ItemDetailsScreen's own image semantics this
/// mirrors. Ownership (the image must belong to this same Item) is enforced by the store - see
/// IItemDetailsStore.SetCoverImageIdAsync.
/// </summary>
public sealed class SetItemCoverImageService(IItemDetailsStore itemDetailsStore) : ISetItemCoverImageService
{
    public Task SetAsync(
        long userId,
        long itemId,
        SetItemCoverImageCommand command,
        CancellationToken cancellationToken = default) =>
        itemDetailsStore.SetCoverImageIdAsync(userId, itemId, command.ImageId, cancellationToken);
}
