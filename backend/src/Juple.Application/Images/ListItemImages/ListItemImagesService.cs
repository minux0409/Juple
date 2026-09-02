namespace Juple.Application.Images.ListItemImages;

public sealed class ListItemImagesService(IItemImageStore itemImageStore) : IListItemImagesService
{
    public Task<IReadOnlyList<ItemImageDto>> ListAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default) =>
        itemImageStore.ListAsync(userId, itemId, cancellationToken);
}
