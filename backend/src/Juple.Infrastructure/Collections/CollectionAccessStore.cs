using Juple.Application.Collections.Access;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionAccessStore(JupleDbContext dbContext) : ICollectionAccessStore
{
    /// <summary>
    /// One indexed query: the Collection (active only) plus whether the caller is its Owner or one
    /// of its collaborators, and in which role. Anyone else - including for a soft-deleted
    /// Collection - gets null.
    /// </summary>
    public async Task<CollectionAccess?> FindAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.Collections
            .AsNoTracking()
            .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null)
            .Select(collection => new
            {
                IsOwner = collection.UserId == userId,
                CollaboratorRole = dbContext.CollectionCollaborators
                    .Where(collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)
                    .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
                    .FirstOrDefault(),
                collection.IsLocked,
                collection.LockVersion,
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
        {
            return null;
        }

        if (row.IsOwner)
        {
            return new CollectionAccess(collectionId, CollectionAccessRole.Owner, row.IsLocked, row.LockVersion);
        }

        return row.CollaboratorRole switch
        {
            CollectionCollaboratorRole.Contributor => new CollectionAccess(collectionId, CollectionAccessRole.Contributor, row.IsLocked, row.LockVersion),
            CollectionCollaboratorRole.Viewer => new CollectionAccess(collectionId, CollectionAccessRole.Viewer, row.IsLocked, row.LockVersion),
            _ => null,
        };
    }
}
