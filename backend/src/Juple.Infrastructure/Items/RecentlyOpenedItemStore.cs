using Juple.Application.Items;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class RecentlyOpenedItemStore(JupleDbContext dbContext) : IRecentlyOpenedItemStore
{
    /// <summary>
    /// The alreadyExists pre-check below is a fast path only, not the actual duplicate-prevention
    /// mechanism - two concurrent RecordOpenAsync calls for the same (userId, itemId) can both pass
    /// it (a genuine TOCTOU race), so the real guarantee is UX_RecentlyOpenedItems_UserId_ItemId
    /// (see RecentlyOpenedItemConfiguration): whichever INSERT loses the race hits that unique
    /// constraint, which the catch below absorbs by updating the winner's LastOpenedAtUtc instead -
    /// unlike CollectionStore.AddAsync's equivalent race (a plain no-op there), this open's
    /// timestamp must still be applied even when it loses the insert race.
    /// </summary>
    public async Task RecordOpenAsync(
        long userId,
        long itemId,
        DateTimeOffset openedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var itemOwned = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (!itemOwned)
        {
            throw new ItemNotFoundException();
        }

        var existing = await dbContext.RecentlyOpenedItems
            .FirstOrDefaultAsync(entry => entry.UserId == userId && entry.ItemId == itemId, cancellationToken);
        if (existing is not null)
        {
            existing.Touch(openedAtUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        dbContext.RecentlyOpenedItems.Add(new RecentlyOpenedItem(userId, itemId, openedAtUtc));

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            var winner = await dbContext.RecentlyOpenedItems
                .FirstOrDefaultAsync(entry => entry.UserId == userId && entry.ItemId == itemId, cancellationToken);
            if (winner is not null)
            {
                winner.Touch(openedAtUtc);
                await dbContext.SaveChangesAsync(cancellationToken);
            }
        }
    }

    public async Task<RecentlyOpenedItemPage> GetPageAsync(
        long userId,
        RecentlyOpenedItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var entriesQuery = dbContext.RecentlyOpenedItems
            .AsNoTracking()
            .Where(entry => entry.UserId == userId);

        if (cursor is not null)
        {
            entriesQuery = entriesQuery.Where(entry =>
                entry.LastOpenedAtUtc < cursor.LastOpenedAtUtc
                || (entry.LastOpenedAtUtc == cursor.LastOpenedAtUtc && entry.ItemId < cursor.ItemId));
        }

        // Inner join is safe here (never silently drops a row): a RecentlyOpenedItem row cannot
        // outlive the Item it references (see RecentlyOpenedItemConfiguration's Cascade-on-Item).
        var pagedQuery =
            from entry in entriesQuery
            join item in dbContext.Items.AsNoTracking().Where(item => item.UserId == userId)
                on entry.ItemId equals item.Id
            orderby entry.LastOpenedAtUtc descending, entry.ItemId descending
            select new { item.Id, item.Url, item.Title, entry.LastOpenedAtUtc };

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var items = pageRows
            .Select(row => new RecentlyOpenedItemEntryDto(row.Id, row.Url, row.Title, row.LastOpenedAtUtc))
            .ToList();

        var nextCursor = hasMore
            ? new RecentlyOpenedItemPageCursor(pageRows[^1].LastOpenedAtUtc, pageRows[^1].Id)
            : null;

        return new RecentlyOpenedItemPage(items, nextCursor);
    }

    public async Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
    {
        var entry = await dbContext.RecentlyOpenedItems
            .FirstOrDefaultAsync(entry => entry.UserId == userId && entry.ItemId == itemId, cancellationToken);
        if (entry is null)
        {
            return;
        }

        dbContext.RecentlyOpenedItems.Remove(entry);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.RecentlyOpenedItems
            .Where(entry => entry.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
}
