namespace Juple.Application.Items.GetItemHistorySections;

/// <summary>
/// One non-empty History section: its stable identity (Key/Kind, Year/Month for a month), the UTC
/// window its links are read from (GET /api/v1/items/history?fromUtc&amp;toUtc - ToUtc null means
/// open-ended), and the exact number of links in it. Never a display label - the app words it.
/// </summary>
public sealed record ItemHistorySectionDto(
    string Key,
    string Kind,
    int? Year,
    int? Month,
    DateTimeOffset FromUtc,
    DateTimeOffset? ToUtc,
    int Count);
