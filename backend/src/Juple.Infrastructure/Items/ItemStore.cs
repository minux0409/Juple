using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class ItemStore(JupleDbContext dbContext) : IInboxEntryStore, IItemLifecycleStore, IItemQueryStore
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

    public async Task<IReadOnlyList<InboxEntryDto>> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default) =>
        await dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId
                && item.State == ItemState.Inbox
                && item.SavedAtUtc >= fromUtc
                && item.SavedAtUtc < toUtc)
            .OrderByDescending(item => item.SavedAtUtc)
            .ThenByDescending(item => item.Id)
            .Select(item => new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc))
            .ToListAsync(cancellationToken);

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

    public async Task<ItemPage> GetByStateAsync(
        long userId,
        ItemState state,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId && item.State == state);

        if (cursor is not null)
        {
            query = query.Where(item =>
                item.StateChangedAtUtc < cursor.StateChangedAtUtc
                || (item.StateChangedAtUtc == cursor.StateChangedAtUtc && item.Id < cursor.Id));
        }

        var page = await query
            .OrderByDescending(item => item.StateChangedAtUtc)
            .ThenByDescending(item => item.Id)
            .Take(limit + 1)
            .Select(item => new ItemListEntryDto(item.Id, item.Url, item.SavedAtUtc, item.StateChangedAtUtc))
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var items = hasMore ? page.GetRange(0, limit) : page;
        var nextCursor = hasMore
            ? new ItemPageCursor(items[^1].StateChangedAtUtc, items[^1].Id)
            : null;

        return new ItemPage(items, nextCursor);
    }
}
