namespace Juple.Domain.Collections;

/// <summary>
/// An Owner's invitation for one specific user (resolved from their Juple ID) to join a Collection.
/// Only that user can accept or decline it - it is addressed to InvitedUserId, not to whoever holds
/// its id, so there is no bearer link to forward. A Pending invitation past ExpiresAtUtc is treated
/// as Expired everywhere (and is persisted as such the next time it is touched).
/// </summary>
public sealed class CollectionInvitation
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);

    private CollectionInvitation()
    {
    }

    public CollectionInvitation(
        long collectionId,
        long invitedUserId,
        long invitedByUserId,
        CollectionCollaboratorRole role,
        DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        InvitedUserId = invitedUserId;
        InvitedByUserId = invitedByUserId;
        Role = role;
        Status = CollectionInvitationStatus.Pending;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = createdAtUtc + Lifetime;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long InvitedUserId { get; private set; }

    public long InvitedByUserId { get; private set; }

    public CollectionCollaboratorRole Role { get; private set; }

    public CollectionInvitationStatus Status { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? RespondedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    public bool IsPendingAt(DateTimeOffset nowUtc) =>
        Status == CollectionInvitationStatus.Pending && ExpiresAtUtc > nowUtc;

    /// <summary>The Owner changes what a still-pending invitation grants; accepting then uses the new role.</summary>
    public void ChangeRole(CollectionCollaboratorRole role, DateTimeOffset nowUtc)
    {
        if (!IsPendingAt(nowUtc))
        {
            throw new InvalidOperationException("Only a pending invitation can change role.");
        }

        Role = role;
    }

    public void Accept(DateTimeOffset nowUtc) => Resolve(CollectionInvitationStatus.Accepted, nowUtc);

    public void Decline(DateTimeOffset nowUtc) => Resolve(CollectionInvitationStatus.Declined, nowUtc);

    public void Revoke(DateTimeOffset nowUtc) => Resolve(CollectionInvitationStatus.Revoked, nowUtc);

    public void MarkExpired(DateTimeOffset nowUtc) => Resolve(CollectionInvitationStatus.Expired, nowUtc);

    private void Resolve(CollectionInvitationStatus status, DateTimeOffset nowUtc)
    {
        if (Status != CollectionInvitationStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending invitation can change status.");
        }

        Status = status;
        RespondedAtUtc = nowUtc;
    }
}
