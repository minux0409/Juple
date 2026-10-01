namespace Juple.Application.Collections;

/// <summary>Color is null only for a Collection that predates this feature (or was
/// system-seeded without one) - see Collection.Color's own remarks on the client-side fallback.</summary>
public sealed record CollectionDto(
    long Id,
    string Name,
    bool IsFavorite,
    int ItemCount,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string Icon,
    string? Color,
    // Collaboration/lock (trailing, defaulted so pre-collaboration call sites keep their meaning):
    // AccessRole is "owner", "contributor" or "viewer" - clients never infer it themselves. IsFavorite is
    // always the CALLER's own favorite mark (see CollectionFavorite) - never someone else's. For a
    // Contributor, OwnerJupleId/OwnerDisplayName identify the Owner; HasCollaborators is only
    // reported to the Owner.
    string AccessRole = CollectionDtoAccessRoles.Owner,
    bool IsLocked = false,
    bool HasCollaborators = false,
    string? OwnerJupleId = null,
    string? OwnerDisplayName = null,
    // Collaborative Collections only: up to CollectionParticipantSummary.PreviewSize OTHER
    // participants (never the caller) - the Owner first, then Contributors in joining order - and
    // how many other participants there are in total. Pending invitations are never participants.
    IReadOnlyList<CollectionParticipantDto>? ParticipantPreview = null,
    int OtherParticipantCount = 0,
    // Owner view only (like HasCollaborators): the 모든 사용자 link is on. Together with
    // HasCollaborators this is exactly what puts an owned Collection under the "shared" scope.
    bool IsPublicShareActive = false,
    // The Collection's icon photo (Owner-chosen), as a short-lived read URL - shown instead of the
    // Icon glyph by everyone who can see the Collection. Null: no photo (or it could not be signed).
    string? IconImageUrl = null,
    // A stable identity of the photo itself (see CollectionIconImageVersion): unchanged while the
    // same photo stays, different after it is replaced, null together with IconImageUrl. Clients
    // key their image cache on this - never on the signed URL, which differs on every response.
    string? IconImageVersion = null,
    // The Collection has its own share password (see CollectionSharePassword): recipients are asked
    // for it before its content opens; the Owner never is. Reported to everyone who can see the
    // card - never the password or anything about it. Separate from IsLocked, which for a recipient
    // only ever means a legacy Collection still opening with its Owner's lock password.
    bool IsSharePasswordProtected = false,
    // Owner view only: how many proposed links (승인 후 추가) wait for the Owner's approval. Always 0
    // for anyone else - proposals are never visible to members or the public.
    int PendingSubmissionCount = 0);

/// <summary>
/// A member of a collaborative Collection as other members see them: public Juple ID and the
/// optional display name they chose - never an internal id or an email. Role is "owner",
/// "contributor" or "viewer". IsMe marks the caller in a full participant list. The profile photo is
/// filled in the full participant list only (not the card preview on every Collection).
/// </summary>
public sealed record CollectionParticipantDto(
    string JupleId,
    string? DisplayName,
    string Role,
    bool IsMe = false,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null);

public static class CollectionParticipantSummary
{
    public const int PreviewSize = 2;
}

public static class CollectionDtoAccessRoles
{
    public const string Owner = "owner";
    public const string Contributor = "contributor";
    public const string Viewer = "viewer";
    public const string Submitter = "submitter";

    /// <summary>The wire role of a non-owner member.</summary>
    public static string ForCollaborator(Juple.Domain.Collections.CollectionCollaboratorRole role) => role switch
    {
        Juple.Domain.Collections.CollectionCollaboratorRole.Viewer => Viewer,
        Juple.Domain.Collections.CollectionCollaboratorRole.Submitter => Submitter,
        _ => Contributor,
    };
}
