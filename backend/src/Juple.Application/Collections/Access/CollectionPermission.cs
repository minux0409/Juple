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
}
