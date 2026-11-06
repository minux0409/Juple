namespace Juple.Application.Billing;

/// <summary>
/// Who owns a Collection - the one fact the owner-level write gate needs. A Collection that does not exist (or a public link that
/// is not active) answers null: the gate then steps aside and the action gives its own, existing 404.
/// </summary>
public interface ICollectionOwnerLookup
{
    Task<long?> FindOwnerUserIdAsync(long collectionId, CancellationToken cancellationToken = default);

    Task<long?> FindOwnerUserIdByPublicIdAsync(string publicId, CancellationToken cancellationToken = default);

    /// <summary>The owner of the Collection a pending invitation would add the person to (null when there is no such invitation).</summary>
    Task<long?> FindOwnerUserIdByInvitationAsync(long invitationId, CancellationToken cancellationToken = default);

}
