namespace Juple.Application.Purchases.CreatePurchase;

public sealed record CreatePurchaseCommand(
    long? ItemId,
    string? ProductName,
    DateOnly? PurchaseDate,
    string? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    string? Quantity,
    string? Memo);
