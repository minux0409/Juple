namespace Juple.Application.Collections.Collaboration;

/// <summary>
/// Persistence for collaborators and invitations. Every mutating method that can conflict with the
/// Collection's public-share / collaboration state runs under an update lock on the Collection row,
/// so "enable public share" and "invite/accept" can never both succeed concurrently.
/// </summary>
public interface ICollectionCollaborationStore
{
    /// <summary>
    /// Creates a Pending invitation with the given role. Throws CollectionCollaborationConflictException
    /// when the role is below an active public share's permission (a Viewer while it grants 링크 추가), the
    /// user already is a collaborator, or an unexpired invitation is pending (stale expired ones are
    /// closed first).
    /// </summary>
    Task<CollectionPendingInvitationDto> CreateInvitationAsync(
        long collectionId,
        long ownerUserId,
        long invitedUserId,
        DateTimeOffset nowUtc,
        Juple.Domain.Collections.CollectionCollaboratorRole role = Juple.Domain.Collections.CollectionCollaboratorRole.Contributor,
        CancellationToken cancellationToken = default);

    /// <summary>Revokes a still-pending invitation of this Collection (idempotent for an already-resolved one).</summary>
    Task RevokeInvitationAsync(
        long collectionId,
        long invitationId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Changes a still-pending invitation's role, under the Collection row lock. 404
    /// (CollectionInvitationNotFoundException) for an invitation of another Collection;
    /// InvitationNotPending once it was answered/revoked/expired; PublicShareActive when changing
    /// to Viewer while the public link grants 링크 추가 (nothing is auto-disabled).
    /// </summary>
    Task ChangeInvitationRoleAsync(
        long collectionId,
        long ownerUserId,
        long invitationId,
        Juple.Domain.Collections.CollectionCollaboratorRole role,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Changes an accepted member's role, under the Collection row lock.
    /// CollectionCollaboratorNotFoundException when they are not a member; PublicShareActive when
    /// changing to Viewer while the public link grants 링크 추가 (nothing is auto-disabled).
    /// </summary>
    Task ChangeCollaboratorRoleAsync(
        long collectionId,
        long ownerUserId,
        long collaboratorUserId,
        Juple.Domain.Collections.CollectionCollaboratorRole role,
        CancellationToken cancellationToken = default);

    Task<CollectionCollaborationOverview> GetOverviewAsync(
        long collectionId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Ends a membership - the one removal behind both leaving and being removed by the Owner. Removes what belongs to the
    /// membership: the membership, the member's still-waiting proposals (and the Owner's notifications about them), their
    /// reactions and their favorite mark. Never the Collection's confirmed content: the links they added (directly, or
    /// proposed and approved) stay, as do their comments. Throws CollectionCollaboratorNotFoundException when they are not
    /// a collaborator.
    /// </summary>
    Task RemoveCollaboratorAsync(
        long collectionId,
        long collaboratorUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The Owner and accepted members - Contributors and Viewers, each with their role (Owner
    /// first, then joining order), IsMe marking
    /// callerUserId. Pending invitations only when includePending (the Owner's view).
    /// </summary>
    Task<CollectionParticipantsDto> GetParticipantsAsync(
        long collectionId,
        long callerUserId,
        bool includePending,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    Task<IReadOnlyList<ReceivedCollectionInvitationDto>> ListReceivedAsync(
        long userId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Accepts an invitation addressed to userId (anyone else: CollectionInvitationNotFoundException).
    /// Idempotent for an invitation this same user already accepted while still a member.
    /// </summary>
    Task AcceptAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Declines an invitation addressed to userId; idempotent for an already-declined one.</summary>
    Task DeclineAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
