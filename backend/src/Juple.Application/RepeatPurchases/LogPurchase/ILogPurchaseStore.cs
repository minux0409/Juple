using Juple.Application.Purchases;

namespace Juple.Application.RepeatPurchases.LogPurchase;

public interface ILogPurchaseStore
{
    /// <summary>
    /// Atomically, in a single DB transaction: loads/verifies ownership of the RepeatPurchase,
    /// checks expectedVersion against its current RowVersion (a mismatch throws
    /// RepeatPurchaseConcurrencyException and leaves both rows untouched), inserts the Purchase
    /// (already linked via Purchase.AssignRepeatPurchase), and advances the RepeatPurchase's
    /// NextPurchaseDate/UpdatedAtUtc (IsEnabled untouched). Either both writes commit or neither
    /// does - a missing/other-user RepeatPurchase throws RepeatPurchaseNotFoundException, and an
    /// Item that no longer exists (a race with a concurrent Item delete) throws
    /// Juple.Application.Items.ItemNotFoundException rather than surfacing a raw FK/DB error.
    /// </summary>
    Task<LogPurchaseResult> LogAsync(
        long userId,
        long repeatPurchaseId,
        PurchaseFields purchaseFields,
        byte[] expectedVersion,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);
}
