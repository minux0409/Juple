namespace Juple.Application.Items.SetItemCoverImage;

public interface ISetItemCoverImageService
{
    Task SetAsync(
        long userId,
        long itemId,
        SetItemCoverImageCommand command,
        CancellationToken cancellationToken = default);
}
