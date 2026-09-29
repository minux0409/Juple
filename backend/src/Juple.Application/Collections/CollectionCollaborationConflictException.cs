namespace Juple.Application.Collections;

/// <summary>
/// An operation conflicts with the Collection's collaboration/public-share state (409) - e.g. a role
/// below the active public link's permission, its minimum (PublicShareActive), turning the public link
/// on or raising its permission while someone has a lower role (PublicSharePermissionMismatch),
/// merging/transferring a collaborative Collection, a duplicate invitation, a new recipient (invitation
/// or public link) for a Collection still in the legacy share-password mode
/// (SharePasswordMigrationRequired - see CollectionSharePasswordMode.LegacyCommonLock).
/// Code is a stable machine-readable reason; nothing is ever auto-disabled to resolve it.
/// </summary>
public sealed class CollectionCollaborationConflictException(string code) : Exception(code)
{
    public const string PublicShareActive = "publicShareActive";
    public const string CollaborationActive = "collaborationActive";
    public const string PublicSharePermissionMismatch = "publicSharePermissionMismatch";
    public const string AlreadyCollaborator = "alreadyCollaborator";
    public const string InvitationPending = "invitationPending";
    public const string InvitationNotPending = "invitationNotPending";
    public const string SharePasswordMigrationRequired = "sharePasswordMigrationRequired";

    public string Code { get; } = code;
}
