namespace Juple.Domain.Safety;

/// <summary>
/// An operator's decision that a shared Collection, or one link in it, may not be seen through sharing. Nothing is deleted: the Owner keeps
/// their Collection and whoever added a link keeps it; the public link and the other members lose access until it is lifted. One row per
/// decision, so the history stays (<see cref="LiftedAtUtc"/> set = no longer in force). <see cref="ItemId"/> null = the whole Collection.
/// </summary>
public sealed class ShareRestriction
{
    private ShareRestriction()
    {
    }

    public ShareRestriction(long collectionId, long? itemId, long? reportId, long adminUserId, DateTimeOffset nowUtc)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        ReportId = reportId;
        RestrictedByAdminUserId = adminUserId;
        RestrictedAtUtc = nowUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long? ItemId { get; private set; }

    /// <summary>The report that led to it, when there was one.</summary>
    public long? ReportId { get; private set; }

    public long RestrictedByAdminUserId { get; private set; }

    public DateTimeOffset RestrictedAtUtc { get; private set; }

    public long? LiftedByAdminUserId { get; private set; }

    public DateTimeOffset? LiftedAtUtc { get; private set; }

    public void Lift(long adminUserId, DateTimeOffset nowUtc)
    {
        LiftedByAdminUserId = adminUserId;
        LiftedAtUtc = nowUtc;
    }
}
