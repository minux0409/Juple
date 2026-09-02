namespace Juple.Application.Images.UploadItemImage;

public sealed class UploadItemImageService(
    IItemImageStore itemImageStore,
    TimeProvider timeProvider) : IUploadItemImageService
{
    private const long MaxByteLength = 10 * 1024 * 1024;

    public Task<ItemImageDto> UploadAsync(
        long userId,
        long itemId,
        byte[]? content,
        CancellationToken cancellationToken = default)
    {
        if (content is null || content.Length == 0)
        {
            throw new InvalidItemImageException("file", "An image file is required.");
        }

        if (content.LongLength > MaxByteLength)
        {
            throw new InvalidItemImageException("file", "Image must be 10MB or smaller.");
        }

        // Never trusts the client-supplied Content-Type or filename - only the file's own bytes
        // decide what format (and therefore extension/ContentType) is actually stored.
        var format = ImageFormatDetector.Detect(content);
        if (format is null)
        {
            throw new InvalidItemImageException("file", "Only JPEG, PNG, or WebP images are allowed.");
        }

        return itemImageStore.UploadAsync(
            userId, itemId, format.Value, content, timeProvider.GetUtcNow(), cancellationToken);
    }
}
