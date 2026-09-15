namespace Juple.Application.UrlMetadata;

/// <summary>
/// Which HTML signal a resolved preview image came from - see HtmlTitleExtractor's priority order.
/// Internal-only (never part of a Controller response): used solely for privacy-safe Dogfood
/// diagnostics (hostname + this enum + booleans - never the image URL itself) when investigating
/// why a given real post did or didn't get a preview image - see UrlMetadataResolver.LogOutcome.
/// </summary>
public enum UrlMetadataImageSource
{
    OpenGraphSecureUrl,
    OpenGraphImage,
    TwitterImage,
    JsonLd,
}
