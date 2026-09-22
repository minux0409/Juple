using Juple.Application.UrlSafety;

namespace Juple.Application.UrlMetadata.ResolveUrlMetadata;

public sealed class ResolveUrlMetadataService(IUrlMetadataResolver urlMetadataResolver, IUrlSafetyChecker urlSafetyChecker)
    : IResolveUrlMetadataService
{
    public async Task<UrlMetadataResult> ResolveAsync(
        ResolveUrlMetadataCommand command,
        CancellationToken cancellationToken = default)
    {
        var url = ValidateUrl(command.Url);
        UrlSafetyCheckException.ThrowIfNotAllowed(await urlSafetyChecker.CheckAsync(url, cancellationToken));
        return await urlMetadataResolver.ResolveAsync(url, cancellationToken);
    }

    /// <summary>
    /// Same shape/length/scheme checks as InboxEntrySaveService.ValidateUrl, plus IsDefaultPort -
    /// this endpoint only ever fetches port 80/443 (see docs on SSRF hardening in
    /// UrlMetadataResolver), so a non-default port is rejected here as a client input error rather
    /// than surfacing later as a silent "no title found".
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
            throw new InvalidUrlMetadataRequestException(
                "url", "A valid HTTP or HTTPS URL using its default port is required.");
        }

        return trimmedUrl;
    }
}
