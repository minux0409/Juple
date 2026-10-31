namespace Juple.Application.Safety;

/// <summary>
/// A small, deliberately modest rule check of content that other people will see in a shared Collection: comments, links and Collection names.
/// It never blocks or changes anything - a match only asks a person at Juple to look (a report with no reporter, Source = AutoFilter), because
/// a rule can be wrong in both directions. An external link is not suspicious by being external. It uses no word list (none fits 17 languages)
/// and no paid or AI service, so it will miss plenty of abuse: it is one input to review, never a claim that shared content is clean.
/// </summary>
public static class SharedContentFilter
{
    public const int MaxUrlsInText = 3;
    public const int RepeatedCharacterRun = 20;

    /// <summary>The rule a text breaks, for the reviewer; null = nothing to ask about.</summary>
    public static string? CheckText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var urls = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Count(word => word.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || word.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
        if (urls >= MaxUrlsInText)
        {
            return "autoFilter:manyUrls";
        }

        var run = 1;
        for (var index = 1; index < text.Length; index++)
        {
            run = text[index] == text[index - 1] && !char.IsWhiteSpace(text[index]) ? run + 1 : 1;
            if (run >= RepeatedCharacterRun)
            {
                return "autoFilter:repeatedCharacters";
            }
        }

        return null;
    }

    /// <summary>The rule an address breaks: a numeric host, credentials in the address, or a punycode host (often a look-alike, and often not).</summary>
    public static string? CheckUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return null;
        }

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            return "autoFilter:urlCredentials";
        }

        if (uri.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6)
        {
            return "autoFilter:urlNumericHost";
        }

        return uri.IdnHost.Split('.').Any(label => label.StartsWith("xn--", StringComparison.OrdinalIgnoreCase)) ? "autoFilter:urlPunycodeHost" : null;
    }
}

/// <summary>Runs the check after a write has succeeded. Best effort: a failure here is logged and never fails or undoes what the person did.</summary>
public interface ISharedContentReviewFlagger
{
    Task FlagCommentAsync(long authorUserId, long collectionId, long commentId, string body, CancellationToken cancellationToken = default);

    Task FlagLinkAsync(long collectionId, long itemId, CancellationToken cancellationToken = default);

    Task FlagCollectionNameAsync(long collectionId, CancellationToken cancellationToken = default);
}
