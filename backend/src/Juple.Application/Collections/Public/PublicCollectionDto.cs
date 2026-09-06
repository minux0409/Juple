namespace Juple.Application.Collections.Public;

/// <summary>
/// The anonymous Public Web Viewer's Collection payload - deliberately not a reuse of the
/// authenticated CollectionDto. Name only: no internal CollectionId/UserId, no ItemCount,
/// RowVersion, IsFavorite, or timestamps - none of those are this viewer's business.
/// </summary>
public sealed record PublicCollectionDto(string Name);
