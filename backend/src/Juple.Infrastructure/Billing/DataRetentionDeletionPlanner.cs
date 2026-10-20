using Juple.Application.Billing;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

/// <summary>Computes <see cref="DataRetentionDeletionPlan"/> with read-only counting queries. It never writes.</summary>
public sealed class DataRetentionDeletionPlanner(JupleDbContext dbContext) : IDataRetentionDeletionPlanner
{
    public async Task<DataRetentionDeletionPlan> PlanAsync(long userId, CancellationToken cancellationToken = default)
    {
        var ownCollections = dbContext.Collections.AsNoTracking().Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null);
        var collectionsKept = await ownCollections
            .CountAsync(collection => dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id), cancellationToken);
        var collectionsToDelete = await ownCollections
            .CountAsync(collection => !dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id), cancellationToken);

        // A link is kept when it is in a live Collection that someone else owns, or that the account owns and still shares with members.
        var keptLinks = dbContext.Items.AsNoTracking().Where(item => item.UserId == userId
            && dbContext.CollectionItems.Any(membership => membership.ItemId == item.Id
                && dbContext.Collections.Any(collection => collection.Id == membership.CollectionId
                    && collection.DeletedAtUtc == null
                    && (collection.UserId != userId
                        || dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id)))));
        var allLinks = dbContext.Items.AsNoTracking().Where(item => item.UserId == userId);
        var linksToDelete = allLinks.Where(item => !keptLinks.Any(kept => kept.Id == item.Id));

        return new DataRetentionDeletionPlan(
            await linksToDelete.CountAsync(cancellationToken),
            await keptLinks.CountAsync(cancellationToken),
            await dbContext.ItemImages.AsNoTracking().CountAsync(image => linksToDelete.Any(item => item.Id == image.ItemId), cancellationToken),
            await dbContext.ItemImages.AsNoTracking().CountAsync(image => keptLinks.Any(item => item.Id == image.ItemId), cancellationToken),
            collectionsToDelete,
            collectionsKept);
    }
}
