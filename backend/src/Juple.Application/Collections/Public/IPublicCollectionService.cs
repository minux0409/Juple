using Juple.Application.Collections;
using Juple.Application.Collections.Locking;

namespace Juple.Application.Collections.Public;

public interface IPublicCollectionService
{
    /// <summary>Null for an unknown/revoked share. A locked share without a valid grant: Name null, IsLocked true.</summary>
    Task<PublicCollectionDto?> GetCollectionAsync(
        string publicId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);

    /// <summary>Null for an unknown/revoked share; CollectionLockedException for a locked one without a valid grant.</summary>
    Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Null for an unknown/revoked share. Throttled per share link; the grant is bound to this share
    /// (a grant for one link never opens another link or the in-app view).
    /// </summary>
    /// <param name="clientAttemptId">
    /// Opaque per-browser attempt id (see CollectionUnlockBuckets) - only scopes the failure counter;
    /// it grants nothing and identifies no one.
    /// </param>
    Task<CollectionUnlockGrant?> UnlockAsync(
        string publicId,
        string? password,
        string? clientAttemptId = null,
        CancellationToken cancellationToken = default);
}
