using Juple.Application.Billing;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

public sealed class CollectionOwnerLookup(JupleDbContext dbContext) : ICollectionOwnerLookup
{
    public async Task<long?> FindOwnerUserIdAsync(long collectionId, CancellationToken cancellationToken = default) =>
        await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId)
            .Select(collection => (long?)collection.UserId)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<long?> FindOwnerUserIdByPublicIdAsync(string publicId, CancellationToken cancellationToken = default) =>
        await dbContext.CollectionShares.AsNoTracking()
            .Where(share => share.PublicId == publicId && share.IsActive)
            .Join(dbContext.Collections.AsNoTracking(), share => share.CollectionId, collection => collection.Id, (share, collection) => (long?)collection.UserId)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<long?> FindOwnerUserIdByInvitationAsync(long invitationId, CancellationToken cancellationToken = default) =>
        await dbContext.CollectionInvitations.AsNoTracking()
            .Where(invitation => invitation.Id == invitationId)
            .Join(dbContext.Collections.AsNoTracking(), invitation => invitation.CollectionId, collection => collection.Id, (invitation, collection) => (long?)collection.UserId)
            .SingleOrDefaultAsync(cancellationToken);
}
