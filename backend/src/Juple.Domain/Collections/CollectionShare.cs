namespace Juple.Domain.Collections;

/// <summary>
/// An "anyone with the link" public share of a Collection - no authentication, no collaborator
/// list, just a single unguessable PublicId that grants read-only access to the Collection's
/// Items via the Public Web Viewer. At most one row per Collection is ever active at a time (see
/// UX_CollectionShares_CollectionId_Active in CollectionShareConfiguration); revoking and
/// re-enabling always mints a brand new PublicId via a brand new row - the old one is never
/// reactivated, so a revoked link stays dead forever (see EnableCollectionShareService).
/// </summary>
public sealed class CollectionShare
{
    private CollectionShare()
    {
    }

    public CollectionShare(long collectionId, string publicId, DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        PublicId = publicId;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = createdAtUtc;
        IsActive = true;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    /// <summary>
    /// The unguessable, URL-safe identifier embedded in the public share URL (see
    /// CollectionSharePublicIdGenerator) - stored as-is (not hashed): the owner must be able to
    /// retrieve and redisplay this exact value on demand (GET .../share, "re-share" reusing the
    /// existing link), which a one-way hash would make impossible. Its entropy, not secrecy of
    /// storage, is the control - the same trade-off "anyone with the link" products (Google
    /// Drive/Notion/Trello share links) make for the same reason.
    /// </summary>
    public string PublicId { get; private set; } = null!;

    public bool IsActive { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    /// <summary>Idempotent - revoking an already-revoked share is a no-op, not an error.</summary>
    public void Revoke(DateTimeOffset revokedAtUtc)
    {
        if (!IsActive)
        {
            return;
        }

        IsActive = false;
        RevokedAtUtc = revokedAtUtc;
        UpdatedAtUtc = revokedAtUtc;
    }
}
