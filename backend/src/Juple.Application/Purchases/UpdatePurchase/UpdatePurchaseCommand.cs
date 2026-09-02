namespace Juple.Application.Purchases.UpdatePurchase;

public sealed record UpdatePurchaseCommand(
    long? ItemId,
    string? ProductName,
    DateOnly? PurchaseDate,
    string? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    string? Quantity,
    string? Memo);
