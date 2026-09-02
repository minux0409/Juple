namespace Juple.Application.RepeatPurchases.LogPurchase;

/// <summary>
/// Deliberately has no ItemId/ProductName/RepeatPurchaseId fields - those are server-derived from
/// the RepeatPurchase itself (see LogPurchaseService), never accepted from the client. Otherwise
/// mirrors Juple.Application.Purchases.CreatePurchase.CreatePurchaseCommand's remaining fields
/// exactly, since they go through the same PurchaseFieldsNormalizer.
/// </summary>
public sealed record LogPurchaseCommand(
    DateOnly? PurchaseDate,
    string? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    string? Quantity,
    string? Memo);
