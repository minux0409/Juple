namespace Juple.Application.UrlMetadata;

/// <summary>
/// Title is null whenever no usable title was found for any reason (no og:title/twitter:title/
/// &lt;title&gt;, SSRF-blocked host, timeout, oversized response, non-HTML content, or a generic
/// placeholder title like a login-wall page) - callers never need to distinguish "not found" from
/// "blocked" from "failed"; only Title's presence matters. Source is non-null only alongside a
/// non-null Title.
/// </summary>
public sealed record UrlMetadataResult(string? Title, UrlMetadataSource? Source);
