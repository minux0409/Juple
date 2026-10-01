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

    /// <summary>
    /// 승인 후 추가: signed-in holders propose their own links, which join only once the Owner
    /// approves them. Between Read and Write in rank. Stored by name ("Submit" fits the column).
    /// </summary>
    Submit,
}

/// <summary>
/// While a public link is active, its permission is the minimum any specific person has - a baseline,
/// not an exact match. The three levels rank 읽기 전용 (Viewer / Read) &lt; 승인 후 추가 (Submitter /
/// Submit) &lt; 링크 추가 (Contributor / Write): a specific person may hold any role at or above the
/// link's own level, never below it, because a person listed below what everyone with the link can
/// already do would misstate their effective permission. Checked by the stores on every invite, role
/// change, accept and public-link change - never fixed up automatically. Ranks are explicit here,
/// never the enums' declaration order (which only ever appends).
/// </summary>
public static class PublicShareRoles
{
    public static int Rank(CollectionCollaboratorRole role) => role switch
    {
        CollectionCollaboratorRole.Viewer => 0,
        CollectionCollaboratorRole.Submitter => 1,
        _ => 2,
    };

    public static int Rank(CollectionSharePermission permission) => permission switch
    {
        CollectionSharePermission.Submit => 1,
        CollectionSharePermission.Write => 2,
        _ => 0,
    };

    /// <summary>The lowest role a specific person may have while a link with this permission is active.</summary>
    public static CollectionCollaboratorRole MinimumFor(CollectionSharePermission permission) => permission switch
    {
        CollectionSharePermission.Write => CollectionCollaboratorRole.Contributor,
        CollectionSharePermission.Submit => CollectionCollaboratorRole.Submitter,
        _ => CollectionCollaboratorRole.Viewer,
    };

    /// <summary>Whether a specific person may hold this role while a link with this permission is active.</summary>
    public static bool Allows(CollectionSharePermission permission, CollectionCollaboratorRole role) =>
        Rank(role) >= Rank(permission);

    /// <summary>The roles below what a link with this permission already gives everyone.</summary>
    public static IReadOnlyList<CollectionCollaboratorRole> RolesBelow(CollectionSharePermission permission) =>
        [.. Enum.GetValues<CollectionCollaboratorRole>().Where(role => !Allows(permission, role))];
}
