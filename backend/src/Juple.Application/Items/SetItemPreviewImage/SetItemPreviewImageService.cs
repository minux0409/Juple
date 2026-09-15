namespace Juple.Application.Items.SetItemPreviewImage;

/// <summary>
/// Sets the auto-extracted link-preview image on an Item - always a best-effort enrichment call
/// (see UrlMetadataResult.PreviewImageUrl), never part of the initial save itself, so a failure
/// here (invalid url, Item not found/owned, concurrency) never affects the Item's own save/update
/// flows; callers already treat this as best-effort and swallow failures (see
/// enrichItemTitleFromUrlMetadata on the mobile side).
/// </summary>
public sealed class SetItemPreviewImageService(IItemDetailsStore itemDetailsStore) : ISetItemPreviewImageService
{
    private const int MaxPreviewImageUrlLength = 4096;

    public Task SetAsync(
        long userId,
        long itemId,
        SetItemPreviewImageCommand command,
        CancellationToken cancellationToken = default)
    {
        var previewImageUrl = ValidateUrl(command.PreviewImageUrl);
        return itemDetailsStore.SetPreviewImageUrlAsync(userId, itemId, previewImageUrl, cancellationToken);
    }

    /// <summary>
    /// Same shape/scheme checks as InboxEntrySaveService.ValidateUrl - this value is always
    /// server-derived (never user-typed), but client input is never trusted regardless of source,
    /// and this is the last point before persistence: rejects data:/file:/blob:/javascript: and any
    /// other non-http(s) scheme, and a malformed or unreasonably long value.
    /// </summary>
    private static string ValidateUrl(string? url)
    {
        var trimmedUrl = url?.Trim();
        if (string.IsNullOrEmpty(trimmedUrl)
            || trimmedUrl.Length > MaxPreviewImageUrlLength
            || !Uri.TryCreate(trimmedUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidItemDetailsException(
                "previewImageUrl", "A valid HTTP or HTTPS image URL is required.");
        }

        return trimmedUrl;
    }
}
