namespace Juple.Application.Collections.Collaboration;

/// <summary>
/// People are only ever identified to other people by their public Juple ID, the optional
/// display name they chose themselves and their optional profile photo (short-lived URL + stable
/// version, see UserProfileImageRef) - never the internal UserId, never an email.
/// </summary>
public sealed record CollectionCollaboratorDto(
    string JupleId,
    string Role,
    DateTimeOffset CreatedAtUtc,
    string? DisplayName = null,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null);

public sealed record CollectionPendingInvitationDto(
    long InvitationId,
    string JupleId,
    string Role,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    string? DisplayName = null,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null);

/// <summary>The Owner-only management view of one Collection's members.</summary>
public sealed record CollectionCollaborationOverview(
    IReadOnlyList<CollectionCollaboratorDto> Collaborators,
    IReadOnlyList<CollectionPendingInvitationDto> PendingInvitations);

/// <summary>A pending invitation as the invited user sees it before accepting.</summary>
public sealed record ReceivedCollectionInvitationDto(
    long InvitationId,
    long CollectionId,
    string CollectionName,
    string Icon,
    string? Color,
    string OwnerJupleId,
    string Role,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    string? OwnerDisplayName = null,
    string? OwnerProfileImageUrl = null,
    string? OwnerProfileImageVersion = null);

/// <summary>Result of an exact Juple ID lookup - the ID, the person's chosen display name and profile photo, nothing else.</summary>
public sealed record JupleIdLookupResult(
    string JupleId,
    bool IsSelf,
    string? DisplayName = null,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null);

/// <summary>
/// Everyone in a Collection, as any member (Owner, Contributor or Viewer) may see it: the Owner and
/// the accepted members with their roles. PendingInvitations and CanManage are the Owner's alone -
/// a Contributor or Viewer gets an empty list and false.
/// </summary>
public sealed record CollectionParticipantsDto(
    IReadOnlyList<CollectionParticipantDto> Participants,
    IReadOnlyList<CollectionPendingInvitationDto> PendingInvitations,
    bool CanManage);
