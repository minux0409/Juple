namespace Juple.Application.Images.DeleteItemImage;

public interface IDeleteItemImageService
{
    Task DeleteAsync(
        long userId,
        long itemId,
        long imageId,
        CancellationToken cancellationToken = default);
}
