namespace Juple.Application.Images.ListItemImages;

public interface IListItemImagesService
{
    Task<IReadOnlyList<ItemImageDto>> ListAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
