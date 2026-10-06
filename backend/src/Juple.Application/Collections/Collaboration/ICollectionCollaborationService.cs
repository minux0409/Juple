namespace Juple.Application.Collections.Collaboration;

public interface ICollectionCollaborationService
{
    /// <summary>Exact Juple ID lookup (no partial match, no browsing). Unknown/malformed: JupleIdNotFoundException.</summary>
    Task<JupleIdLookupResult> LookupAsync(long userId, string? jupleId, CancellationToken cancellationToken = default);

    Task<string> GetMyJupleIdAsync(long userId, CancellationToken cancellationToken = default);

    // Owner-only (ManageCollaborators). Role: Contributor (공동작업) or Viewer (보기 전용 공유).
    Task<CollectionPendingInvitationDto> InviteAsync(
        long userId,
        long collectionId,
        string? jupleId,
        Juple.Domain.Collections.CollectionCollaboratorRole role = Juple.Domain.Collections.CollectionCollaboratorRole.Contributor,
        CancellationToken cancellationToken = default);

    Task RevokeInvitationAsync(long userId, long collectionId, long invitationId, CancellationToken cancellationToken = default);

    Task<CollectionCollaborationOverview> GetOverviewAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task RemoveCollaboratorAsync(long userId, long collectionId, string? jupleId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The caller leaves a Collection they are an accepted member of - through the SAME removal as an Owner removing
    /// them (ICollectionCollaborationStore.RemoveCollaboratorAsync: their reactions, favorite mark, still-waiting
    /// proposals and the Owner's notifications about them, then the membership - never the links they added, which are
    /// the Collection's content and stay), so the two can never disagree. Needs no content grant (leaving never requires the password). The Owner cannot leave
    /// (CollectionForbiddenException); a stranger, a public-link visitor or a pending invitee is not a member
    /// (CollectionNotFoundException).
    /// </summary>
    Task LeaveAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    // Owner-only (ManageCollaborators): 읽기 (Viewer) <-> 쓰기 (Contributor).
    Task ChangeInvitationRoleAsync(
        long userId,
        long collectionId,
        long invitationId,
        Juple.Domain.Collections.CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default);

    Task ChangeCollaboratorRoleAsync(
        long userId,
        long collectionId,
        string? jupleId,
        Juple.Domain.Collections.CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default);

    // Any member (View): who is in this Collection. Pending invitations only for the Owner.
    Task<CollectionParticipantsDto> GetParticipantsAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    // The invited user.
    Task<IReadOnlyList<ReceivedCollectionInvitationDto>> ListReceivedInvitationsAsync(long userId, CancellationToken cancellationToken = default);

    Task AcceptInvitationAsync(long userId, long invitationId, CancellationToken cancellationToken = default);

    Task DeclineInvitationAsync(long userId, long invitationId, CancellationToken cancellationToken = default);
}
