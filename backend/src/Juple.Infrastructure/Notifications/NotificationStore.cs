using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

public sealed class NotificationStore(JupleDbContext dbContext) : INotificationStore
{
    /// <summary>
    /// Lazy materialization, safe under concurrent callers. Reads the candidate set (enabled
    /// RepeatPurchases whose NextPurchaseDate is on or before the user's local today) and the
    /// (RepeatPurchaseId, DueDate) pairs already materialized among them, computes the missing
    /// rows, then inserts one at a time. A single-row SaveChangesAsync per candidate (rather than
    /// one batch insert) means a race lost against a concurrent request - caught via
    /// UX_Notifications_RepeatPurchaseId_DueDate, mirroring RecentlyOpenedItemStore.RecordOpenAsync's
    /// identical unique-constraint-as-race-guard pattern - only discards that one row, never the
    /// rest of this call's otherwise-legitimate inserts.
    /// </summary>
    public async Task MaterializeDueAsync(
        long userId, string timeZoneId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var today = DailyInboxDateRangeCalculator.GetLocalDate(nowUtc, timeZoneId);

        var dueRepeatPurchases = await dbContext.RepeatPurchases
            .AsNoTracking()
            .Where(repeatPurchase =>
                repeatPurchase.UserId == userId
                && repeatPurchase.IsEnabled
                && repeatPurchase.NextPurchaseDate <= today)
            .Select(repeatPurchase => new
            {
                repeatPurchase.Id,
                repeatPurchase.ItemId,
                repeatPurchase.ProductName,
                repeatPurchase.NextPurchaseDate,
            })
            .ToListAsync(cancellationToken);

        if (dueRepeatPurchases.Count == 0)
        {
            return;
        }

        var candidateIds = dueRepeatPurchases.Select(candidate => candidate.Id).ToList();
        var existingKeys = (await dbContext.Notifications
            .AsNoTracking()
            .Where(notification =>
                notification.RepeatPurchaseId != null && candidateIds.Contains(notification.RepeatPurchaseId.Value))
            .Select(notification => new { notification.RepeatPurchaseId, notification.DueDate })
            .ToListAsync(cancellationToken))
            .Select(pair => (RepeatPurchaseId: pair.RepeatPurchaseId!.Value, DueDate: pair.DueDate!.Value))
            .ToHashSet();

        foreach (var candidate in dueRepeatPurchases)
        {
            if (existingKeys.Contains((candidate.Id, candidate.NextPurchaseDate)))
            {
                continue;
            }

            dbContext.Notifications.Add(new Notification(
                userId,
                NotificationType.RepeatPurchaseDue,
                candidate.Id,
                candidate.ItemId,
                candidate.ProductName,
                candidate.NextPurchaseDate,
                nowUtc));

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent request materialized this exact due cycle first - the row already
                // exists, which is exactly what this call wants; nothing further to do for it.
                dbContext.ChangeTracker.Clear();
            }
        }
    }

    public async Task<NotificationPage> ListAsync(
        long userId, NotificationPageCursor? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Notifications
            .AsNoTracking()
            .Where(notification => notification.UserId == userId);

        if (cursor is not null)
        {
            query = query.Where(notification =>
                notification.CreatedAtUtc < cursor.CreatedAtUtc
                || (notification.CreatedAtUtc == cursor.CreatedAtUtc && notification.Id < cursor.Id));
        }

        var pagedQuery = query
            .OrderByDescending(notification => notification.CreatedAtUtc)
            .ThenByDescending(notification => notification.Id)
            .Select(notification => new NotificationDto(
                notification.Id,
                notification.Type,
                notification.RepeatPurchaseId,
                notification.ItemId,
                notification.ProductNameSnapshot,
                notification.DueDate,
                notification.CreatedAtUtc,
                notification.ReadAtUtc));

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var nextCursor = hasMore
            ? new NotificationPageCursor(pageRows[^1].CreatedAtUtc, pageRows[^1].Id)
            : null;

        return new NotificationPage(pageRows, nextCursor);
    }

    public Task<int> GetUnreadCountAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.Notifications
            .AsNoTracking()
            .CountAsync(notification => notification.UserId == userId && notification.ReadAtUtc == null, cancellationToken);

    public async Task MarkReadAsync(
        long userId, long notificationId, DateTimeOffset readAtUtc, CancellationToken cancellationToken = default)
    {
        var notification = await dbContext.Notifications
            .FirstOrDefaultAsync(
                notification => notification.Id == notificationId && notification.UserId == userId,
                cancellationToken);
        if (notification is null)
        {
            throw new NotificationNotFoundException();
        }

        notification.MarkRead(readAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task MarkAllReadAsync(long userId, DateTimeOffset readAtUtc, CancellationToken cancellationToken = default) =>
        dbContext.Notifications
            .Where(notification => notification.UserId == userId && notification.ReadAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(notification => notification.ReadAtUtc, readAtUtc),
                cancellationToken);
}
