namespace Juple.Application.UrlMetadata;

/// <summary>
/// Title is null whenever no usable title was found for any reason (no og:title/twitter:title/
/// &lt;title&gt;, SSRF-blocked host, timeout, oversized response, non-HTML content, or a generic
/// placeholder title like a login-wall page) - callers never need to distinguish "not found" from
/// "blocked" from "failed"; only Title's presence matters. Source is non-null only alongside a
/// non-null Title.
///
/// PreviewImageUrl is a completely independent best-effort signal (og:image:secure_url -&gt;
/// og:image -&gt; twitter:image - see HtmlTitleExtractor) and can be non-null even when Title is
/// null, or vice versa. It is always a validated absolute http/https URL, never a data:/file:/
/// blob:/javascript: or relative one - see docs/product-overview.md's "모르면 모른다고 한다": this
/// is enrichment only, never a requirement for saving a URL.
/// </summary>
public sealed record UrlMetadataResult(string? Title, UrlMetadataSource? Source, string? PreviewImageUrl);
