using Juple.Application.Items;
using Juple.Application.RepeatPurchases;
using Juple.Domain.Purchases;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.RepeatPurchases;

public sealed class RepeatPurchaseStore(JupleDbContext dbContext) : IRepeatPurchaseStore
{
    // Mirrors PurchaseStore's identical translation of a same-request "Item deleted between the
    // ownership check and the write" race into ItemNotFoundException rather than a raw 500 - see
    // that type for the full reasoning.
    private const string ItemForeignKeyConstraintName = "FK_RepeatPurchases_Items_ItemId";

    public async Task<RepeatPurchasePage> ListAsync(
        long userId,
        RepeatPurchasePageCursor? cursor,
        int limit,
        long? itemId,
        bool includeDisabled,
        CancellationToken cancellationToken = default)
    {
        await EnsureItemOwnedIfProvidedAsync(userId, itemId, cancellationToken);

        var query = dbContext.RepeatPurchases
            .AsNoTracking()
            .Where(repeatPurchase => repeatPurchase.UserId == userId);

        if (!includeDisabled)
        {
            query = query.Where(repeatPurchase => repeatPurchase.IsEnabled);
        }

        if (itemId is not null)
        {
            query = query.Where(repeatPurchase => repeatPurchase.ItemId == itemId);
        }

        if (cursor is not null)
        {
            // Ascending keyset: fetch rows strictly after the cursor position, unlike Purchases'
            // descending "< cursor" pagination.
            query = query.Where(repeatPurchase =>
                repeatPurchase.NextPurchaseDate > cursor.NextPurchaseDate
                || (repeatPurchase.NextPurchaseDate == cursor.NextPurchaseDate && repeatPurchase.Id > cursor.Id));
        }

        var pagedQuery = query
            .OrderBy(repeatPurchase => repeatPurchase.NextPurchaseDate)
            .ThenBy(repeatPurchase => repeatPurchase.Id)
            .Select(repeatPurchase => new RepeatPurchaseDto(
                repeatPurchase.Id,
                repeatPurchase.ItemId,
                repeatPurchase.ProductName,
                repeatPurchase.IntervalValue,
                repeatPurchase.IntervalUnit,
                repeatPurchase.NextPurchaseDate,
                repeatPurchase.IsReminderEnabled,
                repeatPurchase.ReminderLeadDays,
                repeatPurchase.IsEnabled,
                repeatPurchase.CreatedAtUtc,
                repeatPurchase.UpdatedAtUtc,
                repeatPurchase.RowVersion));

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var nextCursor = hasMore
            ? new RepeatPurchasePageCursor(pageRows[^1].NextPurchaseDate, pageRows[^1].Id)
            : null;

        return new RepeatPurchasePage(pageRows, nextCursor);
    }

    public Task<RepeatPurchaseDto?> GetAsync(
        long userId,
        long repeatPurchaseId,
        CancellationToken cancellationToken = default) =>
        dbContext.RepeatPurchases
            .AsNoTracking()
            .Where(repeatPurchase => repeatPurchase.Id == repeatPurchaseId && repeatPurchase.UserId == userId)
            .Select(repeatPurchase => new RepeatPurchaseDto(
                repeatPurchase.Id,
                repeatPurchase.ItemId,
                repeatPurchase.ProductName,
                repeatPurchase.IntervalValue,
                repeatPurchase.IntervalUnit,
                repeatPurchase.NextPurchaseDate,
                repeatPurchase.IsReminderEnabled,
                repeatPurchase.ReminderLeadDays,
                repeatPurchase.IsEnabled,
                repeatPurchase.CreatedAtUtc,
                repeatPurchase.UpdatedAtUtc,
                repeatPurchase.RowVersion))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<RepeatPurchaseDto> CreateAsync(
        long userId,
        RepeatPurchaseFields fields,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default)
    {
        await EnsureItemOwnedIfProvidedAsync(userId, fields.ItemId, cancellationToken);

        var repeatPurchase = new RepeatPurchase(
            userId,
            fields.ItemId,
            fields.ProductName,
            fields.IntervalValue,
            fields.IntervalUnit,
            fields.NextPurchaseDate,
            fields.IsReminderEnabled,
            fields.ReminderLeadDays,
            isEnabled: true,
            createdAtUtc,
            createdAtUtc);
        dbContext.RepeatPurchases.Add(repeatPurchase);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerForeignKeyViolationDetector.IsForeignKeyViolation(exception, ItemForeignKeyConstraintName))
        {
            throw new ItemNotFoundException();
        }

        return ToDto(repeatPurchase);
    }

    /// <summary>
    /// When NextPurchaseDate actually changes, resolves this RepeatPurchase's existing unread due
    /// notification(s) - a schedule that just moved is no longer the same due cycle those rows were
    /// about, so leaving them unread would be a stale "action needed" the user already addressed by
    /// editing the date (mirrors LogPurchaseStore/DisableAsync's identical reasoning). If the new
    /// date is itself already due, the next materialize call creates a fresh row for it under its
    /// own DueDate - never done here, this method only ever resolves the old one. Editing anything
    /// else (ProductName, interval, ItemId) while NextPurchaseDate stays the same must never touch
    /// notifications - the comparison below is deliberately scoped to that one field. Both writes
    /// share one explicit transaction so a concurrency conflict rolls back the notification
    /// resolution too, never leaving one resolved for an update that didn't actually commit.
    /// </summary>
    public async Task<RepeatPurchaseDto> UpdateAsync(
        long userId,
        long repeatPurchaseId,
        RepeatPurchaseFields fields,
        byte[] expectedVersion,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var repeatPurchase = await dbContext.RepeatPurchases
            .FirstOrDefaultAsync(
                repeatPurchase => repeatPurchase.Id == repeatPurchaseId && repeatPurchase.UserId == userId,
                cancellationToken);
        if (repeatPurchase is null)
        {
            throw new RepeatPurchaseNotFoundException();
        }

        await EnsureItemOwnedIfProvidedAsync(userId, fields.ItemId, cancellationToken);

        var nextPurchaseDateChanged = repeatPurchase.NextPurchaseDate != fields.NextPurchaseDate;

        repeatPurchase.Update(
            fields.ItemId,
            fields.ProductName,
            fields.IntervalValue,
            fields.IntervalUnit,
            fields.NextPurchaseDate,
            fields.IsReminderEnabled,
            fields.ReminderLeadDays,
            updatedAtUtc);

        // Forces the UPDATE's WHERE clause to check the client's last-read version rather than
        // whatever this fresh SELECT just loaded - a mismatch means someone else changed the row
        // since the client read it, which must surface as a conflict, never a silent overwrite.
        dbContext.Entry(repeatPurchase).Property(entity => entity.RowVersion).OriginalValue = expectedVersion;

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new RepeatPurchaseConcurrencyException(exception);
        }
        catch (DbUpdateException exception) when (
            SqlServerForeignKeyViolationDetector.IsForeignKeyViolation(exception, ItemForeignKeyConstraintName))
        {
            throw new ItemNotFoundException();
        }

        if (nextPurchaseDateChanged)
        {
            await dbContext.Notifications
                .Where(notification =>
                    notification.UserId == userId
                    && notification.RepeatPurchaseId == repeatPurchaseId
                    && notification.ReadAtUtc == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(notification => notification.ReadAtUtc, updatedAtUtc),
                    cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        return ToDto(repeatPurchase);
    }

    public Task<RepeatPurchaseDto> EnableAsync(
        long userId,
        long repeatPurchaseId,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(userId, repeatPurchaseId, repeatPurchase => repeatPurchase.Enable(updatedAtUtc), cancellationToken);

    /// <summary>
    /// Unlike EnableAsync (which reuses the shared TransitionAsync), Disable also resolves whatever
    /// unread due notification(s) this RepeatPurchase currently has - a paused schedule is no
    /// longer action-needed, so its badge/inbox presence should not linger (mirrors LogPurchaseStore's
    /// identical reasoning for a real purchase). Both writes run inside one explicit transaction so a
    /// concurrency conflict below rolls back the notification read-marking too, never leaving
    /// notifications resolved for a disable that didn't actually happen.
    /// </summary>
    public async Task<RepeatPurchaseDto> DisableAsync(
        long userId,
        long repeatPurchaseId,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var repeatPurchase = await dbContext.RepeatPurchases
            .FirstOrDefaultAsync(
                repeatPurchase => repeatPurchase.Id == repeatPurchaseId && repeatPurchase.UserId == userId,
                cancellationToken);
        if (repeatPurchase is null)
        {
            throw new RepeatPurchaseNotFoundException();
        }

        repeatPurchase.Disable(updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new RepeatPurchaseConcurrencyException(exception);
        }

        await dbContext.Notifications
            .Where(notification =>
                notification.UserId == userId
                && notification.RepeatPurchaseId == repeatPurchaseId
                && notification.ReadAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(notification => notification.ReadAtUtc, updatedAtUtc), cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return ToDto(repeatPurchase);
    }

    // Returns the post-transition row (including its current RowVersion, unchanged on a no-op
    // idempotent call) so the caller never ends up holding a version that went stale the instant
    // its own transition committed - mirrors UpdateAsync's identical "return what you just saved"
    // shape.
    private async Task<RepeatPurchaseDto> TransitionAsync(
        long userId,
        long repeatPurchaseId,
        Action<RepeatPurchase> applyTransition,
        CancellationToken cancellationToken)
    {
        var repeatPurchase = await dbContext.RepeatPurchases
            .FirstOrDefaultAsync(
                repeatPurchase => repeatPurchase.Id == repeatPurchaseId && repeatPurchase.UserId == userId,
                cancellationToken);
        if (repeatPurchase is null)
        {
            throw new RepeatPurchaseNotFoundException();
        }

        applyTransition(repeatPurchase);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new RepeatPurchaseConcurrencyException(exception);
        }

        return ToDto(repeatPurchase);
    }

    public async Task DeleteAsync(
        long userId,
        long repeatPurchaseId,
        CancellationToken cancellationToken = default)
    {
        var repeatPurchase = await dbContext.RepeatPurchases
            .FirstOrDefaultAsync(
                repeatPurchase => repeatPurchase.Id == repeatPurchaseId && repeatPurchase.UserId == userId,
                cancellationToken);
        if (repeatPurchase is null)
        {
            return;
        }

        dbContext.RepeatPurchases.Remove(repeatPurchase);

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    // Cross-module ownership check for the Items/RepeatPurchases boundary - mirrors
    // PurchaseStore.EnsureItemOwnedIfProvidedAsync exactly, including reusing that other module's
    // own NotFoundException type rather than inventing a RepeatPurchases-specific one.
    private async Task EnsureItemOwnedIfProvidedAsync(
        long userId,
        long? itemId,
        CancellationToken cancellationToken)
    {
        if (itemId is not { } requestedItemId)
        {
            return;
        }

        var itemIsOwnedByUser = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == requestedItemId && item.UserId == userId, cancellationToken);
        if (!itemIsOwnedByUser)
        {
            throw new ItemNotFoundException();
        }
    }

    private static RepeatPurchaseDto ToDto(RepeatPurchase repeatPurchase) => new(
        repeatPurchase.Id,
        repeatPurchase.ItemId,
        repeatPurchase.ProductName,
        repeatPurchase.IntervalValue,
        repeatPurchase.IntervalUnit,
        repeatPurchase.NextPurchaseDate,
        repeatPurchase.IsReminderEnabled,
        repeatPurchase.ReminderLeadDays,
        repeatPurchase.IsEnabled,
        repeatPurchase.CreatedAtUtc,
        repeatPurchase.UpdatedAtUtc,
        repeatPurchase.RowVersion);
}
