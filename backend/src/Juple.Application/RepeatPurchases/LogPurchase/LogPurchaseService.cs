using Juple.Application.Purchases;

namespace Juple.Application.RepeatPurchases.LogPurchase;

/// <summary>
/// Orchestrates "log an actual purchase against this RepeatPurchase": normalizes the client-
/// submitted Purchase fields (reusing PurchaseFieldsNormalizer verbatim - never re-implementing its
/// validation), with ItemId/ProductName filled in from the RepeatPurchase itself rather than from
/// the client. The read here is a plain, unlocked GetAsync purely to compute normalized fields - it
/// is not the authoritative ownership/version check (ILogPurchaseStore.LogAsync re-loads and
/// version-checks the row itself, inside the same transaction as the writes), so a RepeatPurchase
/// that changed between this read and that check is still caught correctly, just as a 409 rather
/// than silently using stale data.
/// </summary>
public sealed class LogPurchaseService(
    IRepeatPurchaseStore repeatPurchaseStore,
    ILogPurchaseStore logPurchaseStore,
    TimeProvider timeProvider) : ILogPurchaseService
{
    public async Task<LogPurchaseResult> LogAsync(
        long userId,
        long repeatPurchaseId,
        LogPurchaseCommand command,
        byte[] expectedVersion,
        CancellationToken cancellationToken = default)
    {
        var repeatPurchase = await repeatPurchaseStore.GetAsync(userId, repeatPurchaseId, cancellationToken)
            ?? throw new RepeatPurchaseNotFoundException();

        var purchaseFields = PurchaseFieldsNormalizer.Normalize(
            repeatPurchase.ItemId,
            repeatPurchase.ProductName,
            command.PurchaseDate,
            command.Amount,
            command.CurrencyCode,
            command.Store,
            command.Variant,
            command.Quantity,
            command.Memo);

        return await logPurchaseStore.LogAsync(
            userId, repeatPurchaseId, purchaseFields, expectedVersion, timeProvider.GetUtcNow(), cancellationToken);
    }
}
