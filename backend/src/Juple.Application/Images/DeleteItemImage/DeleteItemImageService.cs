namespace Juple.Application.Images.DeleteItemImage;

public sealed class DeleteItemImageService(IItemImageStore itemImageStore) : IDeleteItemImageService
{
    public Task DeleteAsync(
        long userId,
        long itemId,
        long imageId,
        CancellationToken cancellationToken = default) =>
        itemImageStore.DeleteAsync(userId, itemId, imageId, cancellationToken);
}
