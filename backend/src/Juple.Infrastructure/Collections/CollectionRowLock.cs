using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// Serializes the operations whose preconditions span several tables of one Collection - "enable
/// public share" vs "invite/accept collaborator" - by taking an UPDLOCK/HOLDLOCK on the Collection
/// row inside the caller's transaction (same technique as CollectionStore's merge/transfer lock).
/// Whichever runs second sees the first one's committed state and gets a clean 409.
/// </summary>
internal static class CollectionRowLock
{
    /// <summary>Locks the active Collection row; returns its owner's UserId, or null when there is no active Collection.</summary>
    public static async Task<long?> LockActiveAsync(JupleDbContext dbContext, long collectionId, CancellationToken cancellationToken) =>
        await dbContext.Collections
            .FromSqlInterpolated($"SELECT * FROM collections.Collections WITH (UPDLOCK, HOLDLOCK) WHERE Id = {collectionId}")
            .AsNoTracking()
            .Where(collection => collection.DeletedAtUtc == null)
            .Select(collection => (long?)collection.UserId)
            .FirstOrDefaultAsync(cancellationToken);
}
