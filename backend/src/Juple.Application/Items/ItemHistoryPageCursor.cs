namespace Juple.Application.Items;

/// <summary>
/// Keyset pagination position for the History list, ordered by SavedAtUtc DESC, Id DESC (the
/// Item's original save timestamp). Carries no authorization information - callers still filter by
/// UserId independently.
/// </summary>
public sealed record ItemHistoryPageCursor(DateTimeOffset SavedAtUtc, long Id, int? NameBucket = null, string? NameKey = null);

/// <summary>The order the History list is read in: newest saved first (the default), or A-Z by name (see ItemNameOrder).</summary>
public enum ItemHistorySort
{
    Time,
    Name,
}

/// <summary>
/// The one server-side 이름순 for the Archive, over the WHOLE archive and keyset-paged. Each row has a bucket and a key:
/// titled links first (bucket 0, by title), then title-less links (bucket 1, by site host), then every link the caller
/// may not see yet (bucket 2, no key at all - a locked link's hidden title/site can never leak through the order). Ties
/// are newest-saved first, then newest id first - the same tie rule the app uses. Names compare by the database
/// collation (the server cannot apply each app language's own rules).
/// </summary>
public static class ItemNameOrder
{
    public const int Titled = 0;
    public const int TitleLess = 1;
    public const int Gated = 2;
}
