using Juple.Application.Images;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class ItemStore(JupleDbContext dbContext) :
    IInboxEntryStore, IItemLifecycleStore, IItemDetailsStore, IItemDetailQueryStore, IItemHistoryQueryStore,
    IItemTrashQueryStore, IInstagramMetadataCandidateStore
{
    public async Task<string> GetActiveItemUrlAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        await dbContext.Items
            .AsNoTracking()
            .Where(item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null)
            .Select(item => item.Url)
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ItemNotFoundException();

    public async Task<InstagramMetadataCandidateResult> ApplyAutomaticMetadataAsync(
        long userId,
        long itemId,
        NormalizedInstagramMetadata metadata,
        CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(
                item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken)
            ?? throw new ItemNotFoundException();

        if (!item.ApplyAutomaticMetadata(metadata.Title, metadata.PreviewImageUrl))
        {
            return new InstagramMetadataCandidateResult(item.Title, item.PreviewImageUrl, Applied: false);
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new InstagramMetadataCandidateResult(item.Title, item.PreviewImageUrl, Applied: true);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent user edit or retry-Job success landed between the read and this write -
            // that write wins (same policy as InstagramMetadataRetryStore.ApplyResolvedMetadataAsync);
            // report the Item's actual current state rather than the discarded in-memory values.
            dbContext.ChangeTracker.Clear();
            var current = await dbContext.Items
                .AsNoTracking()
                .Where(entry => entry.Id == itemId && entry.UserId == userId)
                .Select(entry => new { entry.Title, entry.PreviewImageUrl })
                .SingleAsync(cancellationToken);
            return new InstagramMetadataCandidateResult(current.Title, current.PreviewImageUrl, Applied: false);
        }
    }

    public async Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        string url,
        Guid? clientRequestId,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default)
    {
        if (clientRequestId is { } requestId)
        {
            var existingRequest = await FindSaveRequestAsync(userId, requestId, cancellationToken);
            if (existingRequest is not null)
            {
                return BuildReplayResult(existingRequest, url);
            }
        }

        var item = new Item(userId, url, savedAtUtc);
        dbContext.Items.Add(item);

        if (clientRequestId is null)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new InboxEntrySaveResult(new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc), Created: true);
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Flush the Item insert first so its generated Id is available for the ledger row below.
        // ItemSaveRequest.ItemId is deliberately not a foreign key (see ItemSaveRequestConfiguration),
        // so EF cannot fix it up automatically via a navigation - it must be assigned explicitly.
        await dbContext.SaveChangesAsync(cancellationToken);

        var saveRequest = new ItemSaveRequest(userId, clientRequestId.Value, item.Id, url, savedAtUtc);
        dbContext.ItemSaveRequests.Add(saveRequest);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
        {
            return await ItemSaveRequestRaceRecovery.RecoverOrRethrowAsync(
                exception,
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception),
                url,
                transaction.RollbackAsync,
                dbContext.ChangeTracker.Clear,
                lookupCancellationToken =>
                    FindSaveRequestAsync(userId, clientRequestId.Value, lookupCancellationToken),
                cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        return new InboxEntrySaveResult(new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc), Created: true);
    }

    private static InboxEntrySaveResult BuildReplayResult(InboxEntryDto existing, string requestedUrl)
    {
        if (existing.Url != requestedUrl)
        {
            throw new InboxEntryClientRequestConflictException();
        }

        return new InboxEntrySaveResult(existing, Created: false);
    }

    private Task<InboxEntryDto?> FindSaveRequestAsync(
        long userId,
        Guid clientRequestId,
        CancellationToken cancellationToken) =>
        dbContext.ItemSaveRequests
            .AsNoTracking()
            .Where(request => request.UserId == userId && request.ClientRequestId == clientRequestId)
            .Select(request => new InboxEntryDto(request.ItemId, request.Url, request.SavedAtUtc))
            .FirstOrDefaultAsync(cancellationToken);

    private async Task TransitionAsync(
        long userId,
        long itemId,
        Action<Item> applyTransition,
        CancellationToken cancellationToken)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (item is null)
        {
            throw new ItemNotFoundException();
        }

        applyTransition(item);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new ItemConcurrencyException(exception);
        }
    }

    public Task UpdateDetailsAsync(
        long userId,
        long itemId,
        string? title,
        string? memo,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(userId, itemId, item => item.UpdateDetails(title, memo), cancellationToken);

    public Task SetPreviewImageUrlAsync(
        long userId,
        long itemId,
        string previewImageUrl,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(userId, itemId, item => item.SetPreviewImageUrl(previewImageUrl), cancellationToken);

    public async Task SetCoverImageIdAsync(
        long userId,
        long itemId,
        long? imageId,
        CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (item is null)
        {
            throw new ItemNotFoundException();
        }

        if (imageId is { } id)
        {
            // CoverImageId is deliberately not a DB-level FK (see Item.CoverImageId's own
            // remarks) - this is the one place ownership (same Item, not just same user) is
            // enforced before the value is ever persisted.
            var imageBelongsToItem = await dbContext.ItemImages
                .AsNoTracking()
                .AnyAsync(image => image.Id == id && image.ItemId == itemId, cancellationToken);
            if (!imageBelongsToItem)
            {
                throw new InvalidItemDetailsException("imageId", "The image does not belong to this Item.");
            }
        }

        item.SetCoverImageId(imageId);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new ItemConcurrencyException(exception);
        }
    }

    public async Task DeleteAsync(
        long userId,
        long itemId,
        DateTimeOffset deletedAtUtc,
        CancellationToken cancellationToken = default)
    {
        // Deliberately does not touch ItemSaveRequests, CollectionItems, or ItemImages - a soft
        // delete only flips DeletedAtUtc (see Item.SoftDelete), so every other row survives intact
        // for RestoreAsync to bring back exactly as it was.
        var item = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (item is null)
        {
            return;
        }

        item.SoftDelete(deletedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            dbContext.ChangeTracker.Clear();
            var stillActive = await dbContext.Items
                .AsNoTracking()
                .AnyAsync(
                    item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null,
                    cancellationToken);
            if (stillActive)
            {
                throw new ItemConcurrencyException(exception);
            }

            // Already moved to trash (or gone entirely) by a concurrent call by the time this
            // SaveChanges ran - the desired end state was already reached, so this is not a
            // conflict.
        }
    }

    public async Task RestoreAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(
                item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc != null,
                cancellationToken);
        if (item is null)
        {
            throw new ItemNotFoundException();
        }

        item.Restore();

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new ItemConcurrencyException(exception);
        }
    }

    public async Task PermanentDeleteAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(
                item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc != null,
                cancellationToken);
        if (item is null)
        {
            throw new ItemNotFoundException();
        }

        dbContext.Items.Remove(item);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            dbContext.ChangeTracker.Clear();
            var stillExists = await dbContext.Items
                .AsNoTracking()
                .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
            if (stillExists)
            {
                throw new ItemConcurrencyException(exception);
            }

            // Gone by the time this ran (a concurrent permanent delete of the same Item) - the
            // desired end state was already reached.
        }
    }

    public async Task<IReadOnlyList<long>> EmptyTrashAsync(
        long userId,
        CancellationToken cancellationToken = default)
    {
        var deletedItems = await dbContext.Items
            .Where(item => item.UserId == userId && item.DeletedAtUtc != null)
            .ToListAsync(cancellationToken);
        if (deletedItems.Count == 0)
        {
            return [];
        }

        dbContext.Items.RemoveRange(deletedItems);
        await dbContext.SaveChangesAsync(cancellationToken);

        return deletedItems.Select(item => item.Id).ToList();
    }

    public async Task<IReadOnlyList<long>> PurgeOldestDeletedBeyondRetentionAsync(
        long userId,
        int maxRetained,
        CancellationToken cancellationToken = default)
    {
        var deletedCount = await dbContext.Items
            .AsNoTracking()
            .CountAsync(item => item.UserId == userId && item.DeletedAtUtc != null, cancellationToken);
        var overflow = deletedCount - maxRetained;
        if (overflow <= 0)
        {
            return [];
        }

        var oldestOverflow = await dbContext.Items
            .Where(item => item.UserId == userId && item.DeletedAtUtc != null)
            .OrderBy(item => item.DeletedAtUtc)
            .ThenBy(item => item.Id)
            .Take(overflow)
            .ToListAsync(cancellationToken);

        dbContext.Items.RemoveRange(oldestOverflow);
        await dbContext.SaveChangesAsync(cancellationToken);

        return oldestOverflow.Select(item => item.Id).ToList();
    }

    public async Task<(IReadOnlyList<ItemTrashEntryDto> Items, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> ListTrashAsync(
        long userId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var query =
            from item in dbContext.Items.AsNoTracking()
            where item.UserId == userId && item.DeletedAtUtc != null
            orderby item.DeletedAtUtc descending, item.Id descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.DeletedAtUtc,
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

        var rows = await query.Take(limit).ToListAsync(cancellationToken);

        var items = new List<ItemTrashEntryDto>(rows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        var coverImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in rows)
        {
            items.Add(new ItemTrashEntryDto(
                row.Id, row.Url, row.Title, row.DeletedAtUtc!.Value,
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

        return (items, representativeImages, coverImages);
    }

    public async Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage, ItemRepresentativeImageRef? CoverImage)> GetDetailsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var query =
            from item in dbContext.Items.AsNoTracking()
            where item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
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

        var row = await query.FirstOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return (null, null, null);
        }

        var details = new ItemDetailsDto(
            row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc,
            RepresentativeImage: null, PreviewImageUrl: row.PreviewImageUrl, CoverImage: null);
        var representativeImage = row.RepresentativeImage is null
            ? null
            : new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
        var coverImage = row.CoverImage is null
            ? null
            : new ItemRepresentativeImageRef(row.CoverImage.Id, row.CoverImage.BlobName);

        return (details, representativeImage, coverImage);
    }

    public async Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetHistoryAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        // Orders/pages by SavedAtUtc (the original save moment). Backed by the existing
        // IX_Items_UserId_SavedAtUtc_Id index - no new index needed.
        var itemsQuery = dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId && item.DeletedAtUtc == null);

        if (cursor is not null)
        {
            itemsQuery = itemsQuery.Where(item =>
                item.SavedAtUtc < cursor.SavedAtUtc
                || (item.SavedAtUtc == cursor.SavedAtUtc && item.Id < cursor.Id));
        }

        var pagedQuery =
            from item in itemsQuery
            orderby item.SavedAtUtc descending, item.Id descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
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

        var items = new List<ItemHistoryEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        var coverImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new ItemHistoryEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc,
                RepresentativeImage: null, PreviewImageUrl: row.PreviewImageUrl, CoverImage: null));
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
            ? new ItemHistoryPageCursor(pageRows[^1].SavedAtUtc, pageRows[^1].Id)
            : null;

        return (new ItemHistoryPage(items, nextCursor), representativeImages, coverImages);
    }

    public async Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetByDateRangeAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        // Same shape as GetHistoryAsync, plus the [fromUtc, toUtc) date-range predicate - unbounded
        // (all-of-a-day) responses are not acceptable for a production API, so this uses the exact
        // same keyset cursor pagination as GetHistoryAsync.
        var itemsQuery = dbContext.Items
            .AsNoTracking()
            .Where(item =>
                item.UserId == userId && item.DeletedAtUtc == null
                && item.SavedAtUtc >= fromUtc && item.SavedAtUtc < toUtc);

        if (cursor is not null)
        {
            itemsQuery = itemsQuery.Where(item =>
                item.SavedAtUtc < cursor.SavedAtUtc
                || (item.SavedAtUtc == cursor.SavedAtUtc && item.Id < cursor.Id));
        }

        var pagedQuery =
            from item in itemsQuery
            orderby item.SavedAtUtc descending, item.Id descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
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

        var items = new List<ItemHistoryEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        var coverImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new ItemHistoryEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc,
                RepresentativeImage: null, PreviewImageUrl: row.PreviewImageUrl, CoverImage: null));
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
            ? new ItemHistoryPageCursor(pageRows[^1].SavedAtUtc, pageRows[^1].Id)
            : null;

        return (new ItemHistoryPage(items, nextCursor), representativeImages, coverImages);
    }
}
