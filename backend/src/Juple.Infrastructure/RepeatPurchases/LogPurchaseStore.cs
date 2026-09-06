using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.RepeatPurchases;
using Juple.Application.RepeatPurchases.LogPurchase;
using Juple.Domain.Purchases;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.RepeatPurchases;

public sealed class LogPurchaseStore(JupleDbContext dbContext) : ILogPurchaseStore
{
    // Same constraint name PurchaseStore/RepeatPurchaseStore already translate - a Purchase whose
    // ItemId points at an Item deleted in the window between this method's own load of the
    // RepeatPurchase and its SaveChanges. In practice that window is already closed by the
    // RowVersion check below: deleting an Item cascades a real SET NULL onto any RepeatPurchase
    // referencing it, which bumps that RepeatPurchase's RowVersion too, so the race almost always
    // surfaces as a RepeatPurchaseConcurrencyException first. This catch is a deliberate second
    // line of defense, not the primary mechanism - it exists so that even in a timing this
    // analysis didn't anticipate, the client still gets a translated 404, never a raw 500.
    private const string ItemForeignKeyConstraintName = "FK_Purchases_Items_ItemId";

    public async Task<LogPurchaseResult> LogAsync(
        long userId,
        long repeatPurchaseId,
        PurchaseFields purchaseFields,
        byte[] expectedVersion,
        DateTimeOffset nowUtc,
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

        // Checked before anything is staged on the change tracker - a schedule that doesn't fit on
        // a calendar must fail cleanly (400, nothing written) rather than reach SaveChangesAsync.
        if (!RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            purchaseFields.PurchaseDate, repeatPurchase.IntervalValue, repeatPurchase.IntervalUnit,
            out var nextPurchaseDate))
        {
            throw new InvalidRepeatPurchaseException(
                "purchaseDate",
                "purchaseDate combined with this RepeatPurchase's interval produces a date outside the supported range.");
        }

        var purchase = new Purchase(
            userId,
            purchaseFields.ItemId,
            purchaseFields.PurchaseDate,
            purchaseFields.ProductName,
            purchaseFields.Amount,
            purchaseFields.CurrencyCode,
            purchaseFields.Store,
            purchaseFields.Variant,
            purchaseFields.Quantity,
            purchaseFields.Memo,
            nowUtc);
        purchase.AssignRepeatPurchase(repeatPurchase.Id);
        dbContext.Purchases.Add(purchase);

        repeatPurchase.RecordPurchase(nextPurchaseDate, nowUtc);

        // A real purchase against this RepeatPurchase resolves whatever due notification(s) it had -
        // an unread "buy this again" reminder makes no sense once the user just bought it. Runs
        // inside this same transaction so a rollback (e.g. a concurrency conflict below) undoes this
        // too, never leaving notifications marked read for a schedule advance that didn't happen.
        await dbContext.Notifications
            .Where(notification =>
                notification.UserId == userId
                && notification.RepeatPurchaseId == repeatPurchaseId
                && notification.ReadAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(notification => notification.ReadAtUtc, nowUtc), cancellationToken);

        // Forces the RepeatPurchase UPDATE's WHERE clause to check the client's last-read version -
        // a mismatch (including one caused by a concurrent Item-delete cascade, see above) means
        // this call must not silently overwrite a change the client never saw, and the whole
        // transaction (Purchase insert included) must roll back with it.
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

        await transaction.CommitAsync(cancellationToken);

        return new LogPurchaseResult(ToPurchaseDto(purchase), ToRepeatPurchaseDto(repeatPurchase));
    }

    private static PurchaseDto ToPurchaseDto(Purchase purchase) => new(
        purchase.Id,
        purchase.ItemId,
        purchase.ProductName,
        purchase.PurchaseDate,
        purchase.Amount,
        purchase.CurrencyCode,
        purchase.Store,
        purchase.Variant,
        purchase.Quantity,
        purchase.Memo,
        purchase.CreatedAtUtc);

    private static RepeatPurchaseDto ToRepeatPurchaseDto(RepeatPurchase repeatPurchase) => new(
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
