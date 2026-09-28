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
/// While a public link is active, its permission is the minimum any specific person has - a baseline,
/// not an exact match: 보기만 (Read) lets a specific person be a Viewer or a Contributor, while 링크
/// 추가 (Write) allows only Contributor, because a Viewer listed below what everyone with the link
/// can already do would misstate their effective permission. Checked by the stores on every invite,
/// role change, accept and public-link change - never fixed up automatically.
/// </summary>
public static class PublicShareRoles
{
    /// <summary>The lowest role a specific person may have while a link with this permission is active.</summary>
    public static CollectionCollaboratorRole MinimumFor(CollectionSharePermission permission) =>
        permission == CollectionSharePermission.Write ? CollectionCollaboratorRole.Contributor : CollectionCollaboratorRole.Viewer;

    /// <summary>Whether a specific person may hold this role while a link with this permission is active.</summary>
    public static bool Allows(CollectionSharePermission permission, CollectionCollaboratorRole role) =>
        permission != CollectionSharePermission.Write || role == CollectionCollaboratorRole.Contributor;
}
