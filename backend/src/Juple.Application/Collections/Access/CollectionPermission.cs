namespace Juple.Application.Collections.Access;

/// <summary>Every operation a Collection endpoint can require - decided in exactly one place (CollectionAccess.Allows).</summary>
public enum CollectionPermission
{
    View,
    AddItem,
    Edit,
    Delete,
    RemoveItem,
    ManageCollaborators,
    ManageLock,
    Favorite,
    ManageShare,

    /// <summary>Merge / cross-Collection item transfer / reorder.</summary>
    Reorganize,

    /// <summary>승인 후 추가: propose one's own link, which joins only once the Owner approves it.</summary>
    SubmitLink,

    /// <summary>See, approve and reject the links waiting for approval - the Owner's alone.</summary>
    ReviewSubmissions,
}
