using Juple.Domain.Collections;

namespace Juple.Application.Collections.Access;

/// <summary>
/// The single source of truth for what a caller may do with one Collection (v1 policy):
/// Owner - everything; Contributor - view the Collection and its links, add their own Items, and
/// keep their own personal favorite mark on it (never anyone else's); Viewer - the same minus adding
/// Items (view and their own favorite mark only); Submitter (승인 후 추가) - a Viewer who may also
/// propose links, which only the Owner turns into links of the Collection; nothing destructive or
/// administrative for any of them. Lock state is carried alongside because it is a separate,
/// additional gate on content (see ICollectionAccessService.RequireContentAsync) - never a
/// replacement for these rights. So is the share password (SharePasswordMode/SharePasswordVersion):
/// an extra gate for recipients only, never for the Owner, and never a right of its own.
/// </summary>
public sealed record CollectionAccess(
    long CollectionId,
    CollectionAccessRole Role,
    bool IsLocked,
    int LockVersion,
    CollectionSharePasswordMode SharePasswordMode = CollectionSharePasswordMode.None,
    int SharePasswordVersion = 0)
{
    public bool IsOwner => Role == CollectionAccessRole.Owner;

    public bool Allows(CollectionPermission permission) => Role switch
    {
        CollectionAccessRole.Owner => true,
        CollectionAccessRole.Contributor => permission is CollectionPermission.View or CollectionPermission.AddItem or CollectionPermission.Favorite,
        CollectionAccessRole.Viewer => permission is CollectionPermission.View or CollectionPermission.Favorite,
        CollectionAccessRole.Submitter => permission is CollectionPermission.View or CollectionPermission.Favorite or CollectionPermission.SubmitLink,
        _ => false,
    };
}
