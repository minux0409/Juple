namespace Juple.Application.UrlMetadata;

/// <summary>Which HTML signal a resolved title came from - see UrlMetadataResolver's priority order.</summary>
public enum UrlMetadataSource
{
    OpenGraph,
    Twitter,
    HtmlTitle,
    YouTubeOEmbed,

    /// <summary>TikTok's official oEmbed endpoint (a TikTok post URL - see TikTokOEmbedResolver).</summary>
    TikTokOEmbed,
}
