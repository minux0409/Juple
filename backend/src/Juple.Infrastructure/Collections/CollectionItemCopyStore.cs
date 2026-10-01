using Juple.Application.Collections;
using Juple.Application.Collections.CopyItems;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionItemCopyStore(JupleDbContext dbContext) : ICollectionItemCopyStore
{
    // Same spacing CollectionStore uses, so later manual reorders still find room between rows.
    private const int SortOrderGap = 4096;

    public async Task<CopyCollectionItemsResult> CopyAsync(
        long userId,
        long sourceCollectionId,
        IReadOnlyList<long> itemIds,
        long destinationCollectionId,
        DateTimeOffset nowUtc,
        bool rejectCallerOwnedItems = false,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        // Serializes with other copies into the same destination and re-checks, inside this
        // transaction, that it is still there and still the caller's.
        if (await CollectionRowLock.LockActiveAsync(dbContext, destinationCollectionId, cancellationToken) != userId)
        {
            throw new CollectionNotFoundException();
        }

        // Only what every participant already sees - never Memo, uploaded images/cover or the adder.
        var sources = await (
                from membership in dbContext.CollectionItems.AsNoTracking()
                where membership.CollectionId == sourceCollectionId && itemIds.Contains(membership.ItemId)
                join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null)
                    on membership.ItemId equals item.Id
                orderby membership.SortOrder, membership.ItemId
                select new { item.Id, item.UserId, item.Url, item.Title, item.PreviewImageUrl })
            .ToListAsync(cancellationToken);
        var unavailable = itemIds.Count - sources.Count;
        if (rejectCallerOwnedItems && sources.Any(source => source.UserId == userId))
        {
            throw new InvalidCollectionException("itemIds", "Your own links are replicated or moved, not copied.");
        }

        // "Already in the destination" = an active link there with the same URL (saving itself never
        // de-duplicates, so the URL is what two copies of one link reliably share).
        var urls = sources.Select(source => source.Url).Distinct(StringComparer.Ordinal).ToList();
        var seenUrls = (await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    where membership.CollectionId == destinationCollectionId
                    join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null)
                        on membership.ItemId equals item.Id
                    where urls.Contains(item.Url)
                    select item.Url)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var toAdd = new List<(long? OwnItemId, Item? NewItem)>();
        foreach (var source in sources)
        {
            if (!seenUrls.Add(source.Url))
            {
                continue;
            }

            if (source.UserId == userId)
            {
                // The caller's own link (they added it to the shared Collection) - reused as itself.
                toAdd.Add((source.Id, null));
                continue;
            }

            var copy = new Item(userId, source.Url, nowUtc);
            copy.UpdateDetails(source.Title, null);
            if (source.PreviewImageUrl is not null)
            {
                copy.SetPreviewImageUrl(source.PreviewImageUrl);
            }

            dbContext.Items.Add(copy);
            toAdd.Add((null, copy));
        }

        if (toAdd.Count == 0)
        {
            return new CopyCollectionItemsResult(0, sources.Count, unavailable);
        }

        // Flush the new Items first so their generated ids exist for the memberships.
        await dbContext.SaveChangesAsync(cancellationToken);

        var minSortOrder = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == destinationCollectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken);
        // Prepended as one block in the source's order: the first copied link ends up on top.
        var sortOrder = (minSortOrder ?? SortOrderGap) - (SortOrderGap * toAdd.Count);
        foreach (var (ownItemId, newItem) in toAdd)
        {
            dbContext.CollectionItems.Add(new CollectionItem(
                destinationCollectionId, ownItemId ?? newItem!.Id, userId, nowUtc, sortOrder));
            sortOrder += SortOrderGap;
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // One of the caller's own links was added to the destination concurrently - nothing of
            // this copy is kept (the transaction rolls back); the app retries on a fresh list.
            throw new CollectionConcurrencyException(exception);
        }

        await transaction.CommitAsync(cancellationToken);
        return new CopyCollectionItemsResult(toAdd.Count, sources.Count - toAdd.Count, unavailable);
    }
}
