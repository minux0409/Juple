using Juple.Application.Collections.Access;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionAccessStore(JupleDbContext dbContext) : ICollectionAccessStore
{
    /// <summary>
    /// One indexed query: the Collection (active only) plus whether the caller is its Owner or one
    /// of its collaborators, and in which role, and its share-password setting (mode and version -
    /// never the hash). Anyone else - including for a soft-deleted Collection - gets null.
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
                SharePassword = dbContext.CollectionSharePasswords
                    .Where(sharePassword => sharePassword.CollectionId == collection.Id)
                    .Select(sharePassword => new { sharePassword.Mode, sharePassword.PasswordVersion })
                    .FirstOrDefault(),
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
        {
            return null;
        }

        var role = row.IsOwner
            ? CollectionAccessRole.Owner
            : row.CollaboratorRole switch
            {
                CollectionCollaboratorRole.Contributor => CollectionAccessRole.Contributor,
                CollectionCollaboratorRole.Viewer => CollectionAccessRole.Viewer,
                CollectionCollaboratorRole.Submitter => CollectionAccessRole.Submitter,
                _ => (CollectionAccessRole?)null,
            };

        return role is { } resolvedRole
            ? new CollectionAccess(
                collectionId,
                resolvedRole,
                row.IsLocked,
                row.LockVersion,
                row.SharePassword?.Mode ?? CollectionSharePasswordMode.None,
                row.SharePassword?.PasswordVersion ?? 0)
            : null;
    }
}
