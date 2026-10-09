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

    /// <summary>The Collection's public link is off (turned off since the app last saw it) - nothing was shared.</summary>
    public const string PublicLinkInactive = "publicLinkInactive";

    /// <summary>A proposed link (승인 후 추가) is already a link of the Collection.</summary>
    public const string LinkAlreadyInCollection = "linkAlreadyInCollection";

    /// <summary>The same link is already waiting for the Owner's approval.</summary>
    public const string LinkAlreadyPending = "linkAlreadyPending";

    /// <summary>The proposal can no longer be approved - its link was deleted by the person who proposed it.</summary>
    public const string SubmissionUnavailable = "submissionUnavailable";

    /// <summary>The public link does not (any more) allow joining this way - its join setting is off or another mode, or the link is gone.</summary>
    public const string JoinNotAllowed = "joinNotAllowed";

    public string Code { get; } = code;
}
