namespace Juple.Application.Images;

/// <summary>
/// The two immutable WebP assets produced from one validated upload. Only the main Blob name is
/// persisted; the thumbnail name is derived from its <c>.main.webp</c> suffix, so existing rows and
/// Blobs need no schema or data migration.
/// </summary>
public sealed record NormalizedItemImage(
    byte[] MainContent,
    int MainWidth,
    int MainHeight,
    byte[] ThumbnailContent,
    int ThumbnailWidth,
    int ThumbnailHeight)
{
    public const string ContentType = "image/webp";
}
