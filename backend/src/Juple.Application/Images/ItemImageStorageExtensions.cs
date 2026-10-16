namespace Juple.Application.Images;

public static class ItemImageStorageExtensions
{
    /// <summary>
    /// Resolves a full display URL and, for a normalized new upload, its list thumbnail. A failed
    /// main URL still removes the image from the response; a failed/missing thumbnail simply lets
    /// old clients and new clients fall back to the main URL.
    /// </summary>
    public static async Task<RepresentativeImageDto?> CreateRepresentativeImageDtoAsync(
        this IItemImageStorage storage,
        long userId,
        ItemRepresentativeImageRef reference,
        CancellationToken cancellationToken = default)
    {
        var readUrl = await storage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        if (readUrl is null)
        {
            return null;
        }

        var thumbnailReadUrl = await storage.CreateThumbnailReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return new RepresentativeImageDto(reference.ImageId, readUrl, thumbnailReadUrl);
    }
}
