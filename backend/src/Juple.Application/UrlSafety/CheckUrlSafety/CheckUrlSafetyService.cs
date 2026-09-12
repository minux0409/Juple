namespace Juple.Application.UrlSafety.CheckUrlSafety;

public sealed class CheckUrlSafetyService(IUrlSafetyChecker urlSafetyChecker) : ICheckUrlSafetyService
{
    public Task<UrlSafetyResult> CheckAsync(
        CheckUrlSafetyCommand command,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateUrl(command.Url);
        return urlSafetyChecker.CheckAsync(url, cancellationToken);
    }

    /// <summary>
    /// Same shape/length/scheme checks as InboxEntrySaveService.ValidateUrl/
    /// ResolveUrlMetadataService.ValidateUrl - this endpoint only ever needs to check URLs that
    /// could actually become (or already are) an Item's URL, so it accepts exactly that same
    /// universe rather than a broader one. Unlike URL metadata resolution, safety lookup never
    /// connects to this URL directly (only the string itself is sent to the configured provider -
    /// see WebRiskUrlSafetyChecker), so the default-port restriction here is for consistency with
    /// Juple's own URL shape, not an SSRF concern.
    /// </summary>
    private static string ValidateUrl(string? url)
    {
        var trimmedUrl = url?.Trim();
        if (string.IsNullOrEmpty(trimmedUrl)
            || trimmedUrl.Length > 4096
            || !Uri.TryCreate(trimmedUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !uri.IsDefaultPort)
        {
            throw new InvalidUrlSafetyRequestException(
                "url", "A valid HTTP or HTTPS URL using its default port is required.");
        }

        return trimmedUrl;
    }
}
