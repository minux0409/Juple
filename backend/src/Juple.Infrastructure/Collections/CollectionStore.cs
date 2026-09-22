using Juple.Application.Collections;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionStore(JupleDbContext dbContext) : ICollectionStore, ICollectionItemStore, ICollectionManagementStore
{
    /// <summary>
    /// Spacing between adjacent CollectionItem.SortOrder values - wide enough that a manual move or
    /// a new prepend almost always just writes the moved/added row's own midpoint value (see
    /// MoveItemAsync/AddAsync), never renumbering the whole Collection. Matches the migration's own
    /// backfill spacing (see AddCollectionItemSortOrder).
    /// </summary>
    private const int SortOrderGap = 4096;


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
            .Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null);

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
        // Projects Icon as its raw (converter-mapped) enum, not .ToString() - EF cannot translate an
        // arbitrary CLR ToString() call inside a SQL projection. The CollectionDto's plain-string
        // Icon is built afterward, once, in memory (see the Select below), never inside the query.
        var page = await query
            .OrderByDescending(collection => collection.CreatedAtUtc)
            .ThenByDescending(collection => collection.Id)
            .Select(collection => new
            {
                collection.Id,
                collection.Name,
                collection.IsFavorite,
                // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own
                // join filter, so the displayed count never disagrees with the list it describes.
                ItemCount = dbContext.CollectionItems
                    .Where(membership => membership.CollectionId == collection.Id)
                    .Count(membership => dbContext.Items.Any(
                        item => item.Id == membership.ItemId && item.DeletedAtUtc == null)),
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc,
                collection.Icon,
                collection.Color,
            })
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageItems = (hasMore ? page.GetRange(0, limit) : page)
            .Select(row => new CollectionDto(
                row.Id, row.Name, row.IsFavorite, row.ItemCount, row.CreatedAtUtc, row.UpdatedAtUtc,
                row.Icon.ToString(), row.Color?.ToString()))
            .ToList();

        var nextCursor = hasMore
            ? new CollectionPageCursor(pageItems[^1].CreatedAtUtc, pageItems[^1].Id)
            : null;

        return new CollectionPage(pageItems, nextCursor);
    }

    public async Task<CollectionDto> CreateAsync(
        long userId,
        string name,
        string nameNormalized,
        CollectionIcon icon,
        DateTimeOffset createdAtUtc,
        CollectionColor? color = null,
        CancellationToken cancellationToken = default)
    {
        var collection = new Collection(userId, name, nameNormalized, icon, createdAtUtc, color);
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
            collection.Id, collection.Name, collection.IsFavorite, 0, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color?.ToString());
    }

    public async Task<CollectionDto> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .AsNoTracking()
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own join
        // filter, so the displayed count never disagrees with the list it describes.
        var itemCount = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Join(
                dbContext.Items.Where(item => item.DeletedAtUtc == null),
                membership => membership.ItemId,
                item => item.Id,
                (membership, item) => membership)
            .CountAsync(cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color?.ToString());
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
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
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
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
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

        // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own join
        // filter, so the displayed count never disagrees with the list it describes.
        var itemCount = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Join(
                dbContext.Items.Where(item => item.DeletedAtUtc == null),
                membership => membership.ItemId,
                item => item.Id,
                (membership, item) => membership)
            .CountAsync(cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color?.ToString());
    }

    public async Task<CollectionDto> SetIconAsync(
        long userId,
        long collectionId,
        CollectionIcon icon,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.SetIcon(icon, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own join
        // filter, so the displayed count never disagrees with the list it describes.
        var itemCount = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Join(
                dbContext.Items.Where(item => item.DeletedAtUtc == null),
                membership => membership.ItemId,
                item => item.Id,
                (membership, item) => membership)
            .CountAsync(cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color?.ToString());
    }

    public async Task<CollectionDto> SetColorAsync(
        long userId,
        long collectionId,
        CollectionColor color,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.SetColor(color, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own join
        // filter, so the displayed count never disagrees with the list it describes.
        var itemCount = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Join(
                dbContext.Items.Where(item => item.DeletedAtUtc == null),
                membership => membership.ItemId,
                item => item.Id,
                (membership, item) => membership)
            .CountAsync(cancellationToken);

        return new CollectionDto(
            collection.Id, collection.Name, collection.IsFavorite, itemCount, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color?.ToString());
    }

    public async Task DeleteAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            return;
        }

        collection.SoftDelete(DateTimeOffset.UtcNow);

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

    public async Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
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
                membership.SortOrder > cursor.SortOrder
                || (membership.SortOrder == cursor.SortOrder && membership.ItemId > cursor.ItemId));
        }

        var pagedQuery =
            from membership in membershipQuery
            // userId is redundant given every CollectionItem row for a userId-owned Collection can
            // only ever reference a userId-owned Item (see AddAsync) - kept anyway as a defense-in-
            // depth ownership check, not just a join condition.
            join item in dbContext.Items.AsNoTracking()
                .Where(item => item.UserId == userId && item.DeletedAtUtc == null)
                on membership.ItemId equals item.Id
            orderby membership.SortOrder ascending, membership.ItemId ascending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                membership.AddedAtUtc,
                membership.SortOrder,
                item.PreviewImageUrl,
                RepresentativeImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id)
                    .OrderBy(image => image.SortOrder)
                    .ThenBy(image => image.Id)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
                CoverImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id && image.Id == item.CoverImageId)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
            };

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var items = new List<CollectionItemEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        var coverImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new CollectionItemEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.AddedAtUtc, row.SortOrder,
                RepresentativeImage: null, row.PreviewImageUrl, CoverImage: null));
            if (row.RepresentativeImage is not null)
            {
                representativeImages[row.Id] =
                    new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
            }
            if (row.CoverImage is not null)
            {
                coverImages[row.Id] = new ItemRepresentativeImageRef(row.CoverImage.Id, row.CoverImage.BlobName);
            }
        }

        var nextCursor = hasMore
            ? new CollectionItemPageCursor(pageRows[^1].SortOrder, pageRows[^1].Id)
            : null;

        return (new CollectionItemPage(items, nextCursor), representativeImages, coverImages);
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
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
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

        // New Items prepend (sort before every existing row) so the default "most recently added
        // first" order is preserved for a Collection the owner has never manually reordered.
        var minSortOrder = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken);
        var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;

        dbContext.CollectionItems.Add(new CollectionItem(collectionId, itemId, addedAtUtc, sortOrder));

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
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
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

    public async Task RestoreAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections.FirstOrDefaultAsync(
            collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc != null,
            cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.Restore();
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<TransferCollectionItemResult> TransferItemAsync(
        long userId,
        long sourceCollectionId,
        long itemId,
        long targetCollectionId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        var itemOwnedAndActive = await dbContext.Items.AsNoTracking().AnyAsync(
            item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken);
        if (!itemOwnedAndActive)
        {
            throw new ItemNotFoundException();
        }

        var sourceMembership = await dbContext.CollectionItems.FirstOrDefaultAsync(
            membership => membership.CollectionId == sourceCollectionId && membership.ItemId == itemId, cancellationToken);
        if (sourceMembership is null)
        {
            throw new ItemNotFoundException();
        }

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return new TransferCollectionItemResult(TargetMembershipCreated: false);
        }

        var targetMembershipExists = await dbContext.CollectionItems.AsNoTracking().AnyAsync(
            membership => membership.CollectionId == targetCollectionId && membership.ItemId == itemId, cancellationToken);
        if (!targetMembershipExists)
        {
            var minSortOrder = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == targetCollectionId)
                .Select(membership => (int?)membership.SortOrder)
                .MinAsync(cancellationToken);
            var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;
            dbContext.CollectionItems.Add(new CollectionItem(targetCollectionId, itemId, sourceMembership.AddedAtUtc, sortOrder));
        }

        dbContext.CollectionItems.Remove(sourceMembership);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new TransferCollectionItemResult(TargetMembershipCreated: !targetMembershipExists);
    }

    public async Task UndoTransferItemAsync(
        long userId,
        long sourceCollectionId,
        long itemId,
        long targetCollectionId,
        bool targetMembershipCreated,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        var itemOwnedAndActive = await dbContext.Items.AsNoTracking().AnyAsync(
            item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken);
        if (!itemOwnedAndActive)
        {
            throw new ItemNotFoundException();
        }

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var sourceMembershipExists = await dbContext.CollectionItems.AsNoTracking().AnyAsync(
            membership => membership.CollectionId == sourceCollectionId && membership.ItemId == itemId, cancellationToken);
        if (!sourceMembershipExists)
        {
            var minSortOrder = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == sourceCollectionId)
                .Select(membership => (int?)membership.SortOrder)
                .MinAsync(cancellationToken);
            var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;
            dbContext.CollectionItems.Add(new CollectionItem(sourceCollectionId, itemId, DateTimeOffset.UtcNow, sortOrder));
        }

        if (targetMembershipCreated)
        {
            var targetMembership = await dbContext.CollectionItems.FirstOrDefaultAsync(
                membership => membership.CollectionId == targetCollectionId && membership.ItemId == itemId, cancellationToken);
            if (targetMembership is not null)
            {
                dbContext.CollectionItems.Remove(targetMembership);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task MergeAsync(
        long userId,
        long sourceCollectionId,
        long targetCollectionId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var source = await dbContext.Collections.FirstAsync(
            collection => collection.Id == sourceCollectionId && collection.UserId == userId, cancellationToken);
        var targetItemIds = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == targetCollectionId)
            .Select(membership => membership.ItemId)
            .ToHashSetAsync(cancellationToken);
        var sourceMemberships = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == sourceCollectionId)
            .OrderBy(membership => membership.SortOrder)
            .ThenBy(membership => membership.Id)
            .ToListAsync(cancellationToken);
        var minSortOrder = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == targetCollectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken) ?? 0;

        foreach (var membership in sourceMemberships)
        {
            if (targetItemIds.Add(membership.ItemId))
            {
                minSortOrder -= SortOrderGap;
                dbContext.CollectionItems.Add(new CollectionItem(
                    targetCollectionId, membership.ItemId, membership.AddedAtUtc, minSortOrder));
            }
        }

        // Cascade deletion preserves the existing Collection delete semantics, including share revocation.
        dbContext.Collections.Remove(source);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task EnsureOwnedCollectionsAsync(
        long userId,
        long sourceCollectionId,
        long targetCollectionId,
        CancellationToken cancellationToken)
    {
        // Lock in stable ID order so concurrent transfer/merge operations cannot observe a partially
        // changed pair. SQL Server applies UPDLOCK/HOLDLOCK through commit.
        var ownedIds = await dbContext.Collections
            .FromSqlInterpolated($"SELECT * FROM collections.Collections WITH (UPDLOCK, HOLDLOCK) WHERE Id IN ({sourceCollectionId}, {targetCollectionId})")
            .AsNoTracking()
            .Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null)
            .Select(collection => collection.Id)
            .ToListAsync(cancellationToken);
        if (!ownedIds.Contains(sourceCollectionId) || !ownedIds.Contains(targetCollectionId))
        {
            throw new CollectionNotFoundException();
        }
    }

    /// <summary>
    /// Moves itemId to immediately after afterItemId (null = front) using gap-based (fractional)
    /// SortOrder positioning: the moved row's new value is the midpoint between its new neighbors,
    /// so a single reorder only ever writes one row unless the gap between those neighbors has been
    /// fully exhausted, in which case the whole Collection is renumbered (still one transaction) -
    /// mirrors ItemImageStore.InsertRowForLockedItemAsync's UPDLOCK+HOLDLOCK pattern, serializing
    /// concurrent reorders/appends on the same Collection instead of adding a RowVersion to
    /// CollectionItem (see CollectionItem's own remarks).
    /// </summary>
    public async Task MoveItemAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var collectionOwned = await dbContext.Collections
            .FromSqlInterpolated($"SELECT * FROM collections.Collections WITH (UPDLOCK, HOLDLOCK) WHERE Id = {collectionId}")
            .AsNoTracking()
            .AnyAsync(collection => collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var movingItem = await dbContext.CollectionItems
            .FirstOrDefaultAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (movingItem is null)
        {
            throw new ItemNotFoundException();
        }

        if (afterItemId == itemId)
        {
            // Moving an item to right after itself is a well-defined no-op, not an error.
            return;
        }

        int? lowerBound = null;
        if (afterItemId is { } anchorItemId)
        {
            lowerBound = await dbContext.CollectionItems
                .AsNoTracking()
                .Where(membership => membership.CollectionId == collectionId && membership.ItemId == anchorItemId)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken);
            if (lowerBound is null)
            {
                throw new ItemNotFoundException();
            }
        }

        var othersQuery = dbContext.CollectionItems
            .AsNoTracking()
            .Where(membership => membership.CollectionId == collectionId && membership.ItemId != itemId);
        var upperBound = lowerBound is { } after
            ? await othersQuery
                .Where(membership => membership.SortOrder > after)
                .OrderBy(membership => membership.SortOrder)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken)
            : await othersQuery
                .OrderBy(membership => membership.SortOrder)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken);

        var needsRenumber =
            (lowerBound.HasValue && upperBound.HasValue && upperBound.Value - (long)lowerBound.Value <= 1)
            || (lowerBound.HasValue && (long)lowerBound.Value + SortOrderGap > int.MaxValue)
            || (upperBound.HasValue && (long)upperBound.Value - SortOrderGap < int.MinValue);

        if (needsRenumber)
        {
            var orderedOthers = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == collectionId && membership.ItemId != itemId)
                .OrderBy(membership => membership.SortOrder)
                .ThenBy(membership => membership.ItemId)
                .ToListAsync(cancellationToken);

            var insertIndex = afterItemId is null
                ? 0
                : orderedOthers.FindIndex(membership => membership.ItemId == afterItemId.Value) + 1;
            orderedOthers.Insert(insertIndex, movingItem);

            for (var index = 0; index < orderedOthers.Count; index++)
            {
                orderedOthers[index].SetSortOrder(index * SortOrderGap);
            }
        }
        else if (!lowerBound.HasValue && !upperBound.HasValue)
        {
            movingItem.SetSortOrder(0);
        }
        else if (!lowerBound.HasValue)
        {
            movingItem.SetSortOrder(upperBound!.Value - SortOrderGap);
        }
        else if (!upperBound.HasValue)
        {
            movingItem.SetSortOrder(lowerBound.Value + SortOrderGap);
        }
        else
        {
            var midpoint = lowerBound.Value + ((long)upperBound.Value - lowerBound.Value) / 2;
            movingItem.SetSortOrder((int)midpoint);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
