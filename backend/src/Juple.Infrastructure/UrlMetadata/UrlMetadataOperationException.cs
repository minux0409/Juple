namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Signals "stop processing this fetch attempt" for any expected operational failure (SSRF-blocked,
/// DNS failure, disallowed scheme/port, oversized response, wrong content type, redirect limit,
/// non-2xx status). Always caught inside UrlMetadataResolver.ResolveAsync and converted to a
/// UrlMetadataResult(null, null) plus a privacy-safe log entry keyed by Category - never escapes
/// to a caller.
/// </summary>
public sealed class UrlMetadataOperationException(string category) : Exception(category)
{
    public string Category { get; } = category;
}
