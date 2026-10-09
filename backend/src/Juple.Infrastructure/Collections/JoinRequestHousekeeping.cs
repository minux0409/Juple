using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// Join requests whose premise is gone. A request only makes sense while the link is a private one (공용 컬렉션 OFF): when the contents
/// become public, the link is revoked or the Collection is deleted, every waiting request becomes Obsolete in the same operation -
/// administrative invalidation, not the Owner's decision: nobody is told "declined", it can no longer be answered, and it never revives
/// (a person simply asks again). Switching the contents to private does NOT call this - that is exactly the state requests live in.
/// </summary>
internal static class JoinRequestHousekeeping
{
    public static Task<int> ObsoleteAllPendingAsync(JupleDbContext dbContext, long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken) =>
        dbContext.CollectionJoinRequests
            .Where(request => request.CollectionId == collectionId && request.Status == CollectionJoinRequestStatus.Pending)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(request => request.Status, CollectionJoinRequestStatus.Obsolete)
                .SetProperty(request => request.ResolvedAtUtc, nowUtc), cancellationToken);
}
