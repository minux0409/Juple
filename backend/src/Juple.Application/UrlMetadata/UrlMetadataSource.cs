namespace Juple.Application.UrlMetadata;

/// <summary>Which HTML signal a resolved title came from - see UrlMetadataResolver's priority order.</summary>
public enum UrlMetadataSource
{
    OpenGraph,
    Twitter,
    HtmlTitle,
}
