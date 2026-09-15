namespace Juple.Application.Items.SetItemPreviewImage;

public interface ISetItemPreviewImageService
{
    Task SetAsync(
        long userId,
        long itemId,
        SetItemPreviewImageCommand command,
        CancellationToken cancellationToken = default);
}
