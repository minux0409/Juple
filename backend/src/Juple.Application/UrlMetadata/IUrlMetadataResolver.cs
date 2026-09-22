namespace Juple.Application.UrlMetadata;

/// <summary>Implemented in Infrastructure (needs outbound HTTP - see UrlMetadataResolver).</summary>
public interface IUrlMetadataResolver
{
    /// <summary>
    /// Best-effort: never throws for an ordinary "no title found"/SSRF-blocked/unreachable/timed-out
    /// outcome - all of those resolve to UrlMetadataResult(null, null); see that type's remarks.
    /// url must already be a validated absolute http/https URL on its default port (see
    /// ResolveUrlMetadataService.ValidateUrl) - this only guards the network-level safety of
    /// actually fetching it, not the request shape.
    /// </summary>
    Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default);
}
