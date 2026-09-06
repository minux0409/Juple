using Juple.Application.Collections;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionStore(JupleDbContext dbContext) : ICollectionStore, ICollectionItemStore
{
    public async Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        bool? isFavorite,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.Collections
            .AsNoTracking()
            .Where(collection => collection.UserId == userId);

        if (isFavorite is { } requestedIsFavorite)
        {
            query = query.Where(collection => collection.IsFavorite == requestedIsFavorite);
        }

        // A filter on the caller's own Collections, not a lookup of the Item itself - a
        // missing/other-user's itemId simply matches no Collections rather than throwing (mirrors
        // GetPurchases' itemId query param).
        if (itemId is { } requestedItemId)
        {
            query = query.Where(collection =>
                dbContext.CollectionItems.Any(
                    membership => membership.CollectionId == collection.Id && membership.ItemId == requestedItemId));
        }

        // The opposite of itemId - a single NOT EXISTS predicate (translated by EF from !Any),
        // not a per-row extra query, so a Collection the Item already belongs to can never
        // resurface as an "add to collection" candidate on any page (unlike filtering client-side
        // against a separately-paginated membership list, which can miss later pages).
        if (excludeItemId is { } excludedItemId)
        {
            query = query.Where(collection =>
                !dbContext.CollectionItems.Any(
                    membership => membership.CollectionId == collection.Id && membership.ItemId == excludedItemId));
        }

        if (cursor is not null)
        {
            query = query.Where(collection =>
                collection.CreatedAtUtc < cursor.CreatedAtUtc
                || (collection.CreatedAtUtc == cursor.CreatedAtUtc && collection.Id < cursor.Id));
        }

        // A single query with a correlated COUNT(*) subquery per row (index-backed by
        // UX_CollectionItems_CollectionId_ItemId/IX_CollectionItems_CollectionId_AddedAtUtc_ItemId)
        // - not an N+1: SQL Server evaluates this as one round trip, not one extra query per
        // Collection. See CollectionsController's ListAsync doc for the observed generated SQL.
        var page = await query
            .OrderByDescending(collection => collection.CreatedAtUtc)
            .ThenByDescending(collection => collection.Id)
            .Select(collection => new CollectionDto(
                collection.Id,
                collection.Name,
                collection.IsFavorite,
                dbContext.CollectionItems.Count(membership => membership.CollectionId == collection.Id),
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc))
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageItems = hasMore ? page.GetRange(0, limit) : page;

        var nextCursor = hasMore
            ? new CollectionPageCursor(pageItems[^1].CreatedAtUtc, pageItems[^1].Id)
            : null;

        return new CollectionPage(pageItems, nextCursor);
    }

    public async Task<CollectionDto> CreateAsync(
        long userId,
        string name,
        string nameNormalized,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = new Collection(userId, name, nameNormalized, createdAtUtc);
        dbContext.Collections.Add(collection);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CollectionNameConflictException();
        }

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, 0, collection.CreatedAtUtc, collection.UpdatedAtUtc);
    }

    public async Task<CollectionDto> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .AsNoTracking()
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        var itemCount = await dbContext.CollectionItems
            .CountAsync(membership => membership.CollectionId == collectionId, cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc, collection.UpdatedAtUtc);
    }

    public async Task RenameAsync(
        long userId,
        long collectionId,
        string name,
        string nameNormalized,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.Rename(name, nameNormalized, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CollectionNameConflictException();
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }
    }

    public async Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        bool isFavorite,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.SetFavorite(isFavorite, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        var itemCount = await dbContext.CollectionItems
            .CountAsync(membership => membership.CollectionId == collectionId, cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc, collection.UpdatedAtUtc);
    }

    public async Task DeleteAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (collection is null)
        {
            return;
        }

        // CollectionItem rows for this Collection cascade-delete at the database level (see
        // CollectionItemConfiguration) - the Items they reference are never touched.
        dbContext.Collections.Remove(collection);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Matches Category's delete-vs-delete race handling: another request already removed
            // this Collection, so the desired end state (absent) was already reached.
        }
    }

    public async Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetItemsAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var membershipQuery = dbContext.CollectionItems
            .AsNoTracking()
            .Where(membership => membership.CollectionId == collectionId);

        if (cursor is not null)
        {
            membershipQuery = membershipQuery.Where(membership =>
                membership.AddedAtUtc < cursor.AddedAtUtc
                || (membership.AddedAtUtc == cursor.AddedAtUtc && membership.ItemId < cursor.ItemId));
        }

        var pagedQuery =
            from membership in membershipQuery
            // userId is redundant given every CollectionItem row for a userId-owned Collection can
            // only ever reference a userId-owned Item (see AddAsync) - kept anyway as a defense-in-
            // depth ownership check, not just a join condition.
            join item in dbContext.Items.AsNoTracking().Where(item => item.UserId == userId)
                on membership.ItemId equals item.Id
            orderby membership.AddedAtUtc descending, membership.ItemId descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                membership.AddedAtUtc,
                RepresentativeImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id)
                    .OrderBy(image => image.SortOrder)
                    .ThenBy(image => image.Id)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
            };

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var items = new List<CollectionItemEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new CollectionItemEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.AddedAtUtc,
                RepresentativeImage: null));
            if (row.RepresentativeImage is not null)
            {
                representativeImages[row.Id] =
                    new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
            }
        }

        var nextCursor = hasMore
            ? new CollectionItemPageCursor(pageRows[^1].AddedAtUtc, pageRows[^1].Id)
            : null;

        return (new CollectionItemPage(items, nextCursor), representativeImages);
    }

    /// <summary>
    /// The alreadyMember pre-check below is a fast path only, not the actual duplicate-prevention
    /// mechanism - two concurrent AddAsync calls for the same (collectionId, itemId) can both pass
    /// it (a genuine TOCTOU race), so the real guarantee is UX_CollectionItems_CollectionId_ItemId
    /// (see CollectionItemConfiguration): whichever INSERT loses the race hits that unique
    /// constraint, which the catch below absorbs as the same no-op success as the pre-check path.
    /// Either way, the database can never end up with two CollectionItem rows for the same pair.
    /// </summary>
    public async Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        DateTimeOffset addedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var itemOwned = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (!itemOwned)
        {
            throw new ItemNotFoundException();
        }

        // A repeat Add is a no-op, not a conflict - this is a "set membership" write (mirrors
        // Item.MoveToWishlist's own already-there no-op), never a strict create.
        var alreadyMember = await dbContext.CollectionItems
            .AsNoTracking()
            .AnyAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (alreadyMember)
        {
            return;
        }

        dbContext.CollectionItems.Add(new CollectionItem(collectionId, itemId, addedAtUtc));

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent Add for the same (collectionId, itemId) pair already won the race - the
            // desired end state (membership exists) was already reached.
        }
    }

    public async Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId, cancellationToken);
        if (!collectionOwned)
        {
            return;
        }

        var membership = await dbContext.CollectionItems
            .FirstOrDefaultAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (membership is null)
        {
            return;
        }

        dbContext.CollectionItems.Remove(membership);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent Remove (or the Item itself being deleted, cascading this row away)
            // already removed this membership row - the desired end state (absent) was already
            // reached.
        }
    }
}
