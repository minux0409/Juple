namespace Juple.Domain.Collections;

/// <summary>
/// A non-owner member of a Collection (see CollectionAccess for what each role may do). Created only
/// by accepting a CollectionInvitation addressed to this exact user - never directly from input.
/// </summary>
public sealed class CollectionCollaborator
{
    private CollectionCollaborator()
    {
    }

    public CollectionCollaborator(
        long collectionId,
        long userId,
        CollectionCollaboratorRole role,
        long createdByUserId,
        DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        UserId = userId;
        Role = role;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long UserId { get; private set; }

    public CollectionCollaboratorRole Role { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>The Owner who issued the accepted invitation.</summary>
    public long CreatedByUserId { get; private set; }

    /// <summary>
    /// The Owner switches this member between 읽기 (Viewer) and 쓰기 (Contributor). Takes effect on
    /// the member's very next request - access is resolved from this row every time. Links they
    /// added while a Contributor stay in the Collection.
    /// </summary>
    public void ChangeRole(CollectionCollaboratorRole role) => Role = role;
}
