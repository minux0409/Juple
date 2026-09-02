namespace Juple.Application.Images.UploadItemImage;

public interface IUploadItemImageService
{
    Task<ItemImageDto> UploadAsync(
        long userId,
        long itemId,
        byte[]? content,
        CancellationToken cancellationToken = default);
}
