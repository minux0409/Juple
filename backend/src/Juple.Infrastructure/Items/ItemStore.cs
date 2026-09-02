using Juple.Application.Categories;
using Juple.Application.Images;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class ItemStore(JupleDbContext dbContext) :
    IInboxEntryStore, IItemLifecycleStore, IItemQueryStore, IItemDetailsStore, IItemDetailQueryStore,
    IItemCategoryStore
{
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

    public async Task<(IReadOnlyList<DailyInboxEntryDto> Items, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default)
    {
        var query =
            from item in dbContext.Items.AsNoTracking()
            where item.UserId == userId
                && item.State == ItemState.Inbox
                && item.SavedAtUtc >= fromUtc
                && item.SavedAtUtc < toUtc
            join category in dbContext.Categories.AsNoTracking()
                on item.CategoryId equals category.Id into categoryJoin
            from category in categoryJoin.DefaultIfEmpty()
            orderby item.SavedAtUtc descending, item.Id descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
                Category = category == null ? null : new ItemCategoryDto(category.Id, category.Name),
                // SortOrder ASC, Id ASC first image, translated as a correlated subquery (OUTER
                // APPLY on SQL Server) - one round trip for the whole page, not one per Item.
                RepresentativeImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id)
                    .OrderBy(image => image.SortOrder)
                    .ThenBy(image => image.Id)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
            };

        var rows = await query.ToListAsync(cancellationToken);

        var items = new List<DailyInboxEntryDto>(rows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in rows)
        {
            items.Add(new DailyInboxEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc, row.Category, RepresentativeImage: null));
            if (row.RepresentativeImage is not null)
            {
                representativeImages[row.Id] =
                    new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
            }
        }

        return (items, representativeImages);
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

    public Task MoveToWishlistAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(userId, itemId, item => item.MoveToWishlist(changedAtUtc), cancellationToken);

    public Task MoveToArchiveAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(userId, itemId, item => item.MoveToArchive(changedAtUtc), cancellationToken);

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

    public async Task AssignCategoryAsync(
        long userId,
        long itemId,
        long? categoryId,
        CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (item is null)
        {
            throw new ItemNotFoundException();
        }

        if (categoryId is { } requestedCategoryId)
        {
            var categoryIsOwnedByUser = await dbContext.Categories
                .AsNoTracking()
                .AnyAsync(
                    category => category.Id == requestedCategoryId && category.UserId == userId,
                    cancellationToken);
            if (!categoryIsOwnedByUser)
            {
                throw new CategoryNotFoundException();
            }
        }

        item.AssignCategory(categoryId);

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
        CancellationToken cancellationToken = default)
    {
        // Deliberately does not touch ItemSaveRequests: that ledger is independent of the
        // Item's lifecycle and must survive this delete (see ItemSaveRequestConfiguration).
        var item = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (item is null)
        {
            return;
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

            // The Item was gone by the time the DELETE ran (a concurrent delete of the same
            // Item) - the desired end state (absent) was already reached, so this is not a
            // conflict.
        }
    }

    public async Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage)> GetDetailsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var query =
            from item in dbContext.Items.AsNoTracking()
            where item.Id == itemId && item.UserId == userId
            join category in dbContext.Categories.AsNoTracking()
                on item.CategoryId equals category.Id into categoryJoin
            from category in categoryJoin.DefaultIfEmpty()
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
                item.State,
                item.StateChangedAtUtc,
                Category = category == null ? null : new ItemCategoryDto(category.Id, category.Name),
                RepresentativeImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id)
                    .OrderBy(image => image.SortOrder)
                    .ThenBy(image => image.Id)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
            };

        var row = await query.FirstOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return (null, null);
        }

        var details = new ItemDetailsDto(
            row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc, row.State, row.StateChangedAtUtc, row.Category,
            RepresentativeImage: null);
        var representativeImage = row.RepresentativeImage is null
            ? null
            : new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);

        return (details, representativeImage);
    }

    public async Task<(ItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetByStateAsync(
        long userId,
        ItemState state,
        long? categoryId,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        if (categoryId is { } requestedCategoryId)
        {
            var categoryIsOwnedByUser = await dbContext.Categories
                .AsNoTracking()
                .AnyAsync(
                    category => category.Id == requestedCategoryId && category.UserId == userId,
                    cancellationToken);
            if (!categoryIsOwnedByUser)
            {
                throw new CategoryNotFoundException();
            }
        }

        var itemsQuery = dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId && item.State == state);

        if (categoryId is not null)
        {
            itemsQuery = itemsQuery.Where(item => item.CategoryId == categoryId);
        }

        if (cursor is not null)
        {
            itemsQuery = itemsQuery.Where(item =>
                item.StateChangedAtUtc < cursor.StateChangedAtUtc
                || (item.StateChangedAtUtc == cursor.StateChangedAtUtc && item.Id < cursor.Id));
        }

        var pagedQuery =
            from item in itemsQuery
            join category in dbContext.Categories.AsNoTracking()
                on item.CategoryId equals category.Id into categoryJoin
            from category in categoryJoin.DefaultIfEmpty()
            orderby item.StateChangedAtUtc descending, item.Id descending
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                item.Memo,
                item.SavedAtUtc,
                item.StateChangedAtUtc,
                Category = category == null ? null : new ItemCategoryDto(category.Id, category.Name),
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

        var items = new List<ItemListEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new ItemListEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.SavedAtUtc, row.StateChangedAtUtc, row.Category,
                RepresentativeImage: null));
            if (row.RepresentativeImage is not null)
            {
                representativeImages[row.Id] =
                    new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
            }
        }

        var nextCursor = hasMore
            ? new ItemPageCursor(pageRows[^1].StateChangedAtUtc, pageRows[^1].Id)
            : null;

        return (new ItemPage(items, nextCursor), representativeImages);
    }
}
