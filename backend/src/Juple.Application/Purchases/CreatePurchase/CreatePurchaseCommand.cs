namespace Juple.Application.Purchases.CreatePurchase;

public sealed record CreatePurchaseCommand(
    long? ItemId,
    string? ProductName,
    DateOnly? PurchaseDate,
    decimal? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    decimal? Quantity,
    string? Memo);
