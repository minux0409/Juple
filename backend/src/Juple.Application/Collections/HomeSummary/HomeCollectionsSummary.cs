namespace Juple.Application.Collections.HomeSummary;

/// <summary>
/// What Home shows about the caller's Collections - nothing more: the exact number in each of its three scopes (the same
/// definitions as <see cref="ListCollections.CollectionListScope"/> All / Favorites / Shared) and the first favorite
/// Collections as shortcuts, in the Collections list's own order (newest first). One response instead of three full lists.
/// </summary>
public sealed record HomeCollectionsSummary(
    int CollectionCount,
    int FavoriteCollectionCount,
    int SharedCollectionCount,
    IReadOnlyList<HomeFavoriteCollectionDto> FavoriteCollections)
{
    public static HomeCollectionsSummary Empty { get; } = new(0, 0, 0, []);
}

/// <summary>
/// The few fields a Home shortcut draws (tile + name + link count). Same values the Collections list reports for the row:
/// ItemCount excludes links whose Item is in the trash; the icon photo is the same short-lived read URL + stable version.
/// </summary>
public sealed record HomeFavoriteCollectionDto(
    long Id,
    string Name,
    int ItemCount,
    string Icon,
    string? Color,
    string? IconImageUrl,
    string? IconImageVersion);
