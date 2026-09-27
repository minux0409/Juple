namespace Juple.Application.Collections.Public;

/// <summary>
/// The anonymous Public Web Viewer's Collection payload - deliberately not a reuse of the
/// authenticated CollectionDto. No internal CollectionId/UserId, no ItemCount, RowVersion,
/// IsFavorite, or timestamps - none of those are this viewer's business.
///
/// A locked share reveals nothing until its password is proven: Name is null and IsLocked is true
/// (minimum disclosure - not even the Collection's name). With a valid unlock grant Name is present.
/// Permission ("read" / "write") tells a client whether signed-in holders may add links; it is null
/// while the share is locked and not yet unlocked (nothing is disclosed then).
/// </summary>
public sealed record PublicCollectionDto(string? Name, bool IsLocked, string? Permission = null);
