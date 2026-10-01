using Juple.Application.Collections.Reactions;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionItemReactionStore(JupleDbContext dbContext) : ICollectionItemReactionStore
{
    public async Task<bool> SetAsync(
        long userId, long collectionId, long itemId, string key, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var isLink = await (
            from membership in dbContext.CollectionItems.AsNoTracking()
            where membership.CollectionId == collectionId && membership.ItemId == itemId
            join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null) on membership.ItemId equals item.Id
            select membership.Id).AnyAsync(cancellationToken);
        if (!isLink)
        {
            return false;
        }

        // Two writes of the same person racing end with exactly one row: the UPDATE rewrites the row if
        // it exists; otherwise the INSERT either wins or loses to the other write on the unique index,
        // and then the UPDATE is simply tried again.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var updated = await dbContext.CollectionItemReactions
                .Where(reaction => reaction.CollectionId == collectionId && reaction.ItemId == itemId && reaction.UserId == userId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(reaction => reaction.ReactionKey, key), cancellationToken);
            if (updated > 0)
            {
                return true;
            }

            var created = new CollectionItemReaction(collectionId, itemId, userId, key, nowUtc);
            dbContext.CollectionItemReactions.Add(created);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return true;
            }
            catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                dbContext.Entry(created).State = EntityState.Detached;
            }
            catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 547 })
            {
                // The link left the Collection between the check and the write.
                dbContext.Entry(created).State = EntityState.Detached;
                return false;
            }
        }

        throw new InvalidOperationException("The reaction could not be written after repeated concurrent changes.");
    }

    public async Task DeleteAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        await dbContext.CollectionItemReactions
            .Where(reaction => reaction.CollectionId == collectionId && reaction.ItemId == itemId && reaction.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<long, CollectionItemReactionsDto>> GetSummariesAsync(
        long userId, long collectionId, IReadOnlyCollection<long> itemIds, CancellationToken cancellationToken = default)
    {
        if (itemIds.Count == 0)
        {
            return new Dictionary<long, CollectionItemReactionsDto>();
        }

        var ids = itemIds.ToList();
        // 1: the counts per link and reaction (the unique index's (CollectionId, ItemId) prefix covers the filter).
        var counts = await dbContext.CollectionItemReactions.AsNoTracking()
            .Where(reaction => reaction.CollectionId == collectionId && ids.Contains(reaction.ItemId))
            .GroupBy(reaction => new { reaction.ItemId, reaction.ReactionKey })
            .Select(group => new { group.Key.ItemId, group.Key.ReactionKey, Count = group.Count() })
            .ToListAsync(cancellationToken);
        if (counts.Count == 0)
        {
            return new Dictionary<long, CollectionItemReactionsDto>();
        }

        // 2: the caller's own reactions to these links.
        var mine = await dbContext.CollectionItemReactions.AsNoTracking()
            .Where(reaction => reaction.CollectionId == collectionId && reaction.UserId == userId && ids.Contains(reaction.ItemId))
            .Select(reaction => new { reaction.ItemId, reaction.ReactionKey })
            .ToDictionaryAsync(reaction => reaction.ItemId, reaction => reaction.ReactionKey, cancellationToken);

        return counts
            .GroupBy(row => row.ItemId)
            .ToDictionary(
                group => group.Key,
                group => new CollectionItemReactionsDto(
                    [.. group
                        .OrderByDescending(row => row.Count)
                        .ThenBy(row => CollectionReactionCatalog.OrderOf(row.ReactionKey))
                        .Select(row => new ReactionCountDto(row.ReactionKey, row.Count))],
                    mine.TryGetValue(group.Key, out var key) ? key : null));
    }
}
