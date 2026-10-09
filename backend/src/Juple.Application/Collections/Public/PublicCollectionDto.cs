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
/// IsPublic false: the link is a PRIVATE one - only the Collection's name (after any password) is given, so a signed-in visitor can be
/// asked whether to request joining; no content is ever served for it. A locked, not yet unlocked share reveals even that only after the password.
/// </summary>
/// Icon / Color: the Collection's own look - never an uploaded picture or any content - so the 컬렉션 추가 / 참가 요청 dialogs can show the same
/// tile the Collection has in the app (public and private links alike; the app never fetches a public link's items for them).
/// IconImageUrl / IconImageVersion: the Collection's OWN profile photo, exactly as the Collection list and details show it (a short-lived signed
/// read URL plus the photo's stable version) - the one explicitly designated image of this identity. Never an item photo or preview.
public sealed record PublicCollectionDto(
    string? Name,
    bool IsLocked,
    string? Permission = null,
    bool IsPublic = true,
    string? Icon = null,
    string? Color = null,
    string? IconImageUrl = null,
    string? IconImageVersion = null);
