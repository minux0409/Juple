namespace Juple.Application.Collections.GetCollectionItems;

/// <summary>
/// One date section of a Collections links, exactly like a History section (see
/// ItemHistorySectionDto): identity, its [FromUtc, ToUtc) window over AddedAtUtc (ToUtc null =
/// open-ended, today) and the exact number of links in it. No display text - the client words it.
/// </summary>
public sealed record CollectionItemSectionDto(
    string Key,
    string Kind,
    int? Year,
    int? Month,
    DateTimeOffset FromUtc,
    DateTimeOffset? ToUtc,
    int Count);
