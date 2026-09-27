namespace Juple.Domain.Collections;

/// <summary>
/// What an active public share link lets its holders do. Persisted as its name (string), never its
/// ordinal. Read is the original, anonymous "anyone with the link can view". Write additionally lets
/// holders who are SIGNED IN to Juple add their own links - never anonymously, never anything else
/// (no editing, removing, reordering or managing, and no membership).
/// </summary>
public enum CollectionSharePermission
{
    Read,
    Write,
}

/// <summary>
/// While a public link is active, every specific person's role equals the link's permission:
/// 보기만 (Read) → Viewer, 링크 추가 (Write) → Contributor. Checked by the stores on every invite,
/// role change, accept and public-link change - never fixed up automatically.
/// </summary>
public static class PublicShareRoles
{
    public static CollectionCollaboratorRole For(CollectionSharePermission permission) =>
        permission == CollectionSharePermission.Write ? CollectionCollaboratorRole.Contributor : CollectionCollaboratorRole.Viewer;
}
