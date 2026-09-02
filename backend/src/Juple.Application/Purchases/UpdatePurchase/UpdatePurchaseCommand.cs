namespace Juple.Application.Purchases.UpdatePurchase;

public sealed record UpdatePurchaseCommand(
    long? ItemId,
    string? ProductName,
    DateOnly? PurchaseDate,
    decimal? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    decimal? Quantity,
    string? Memo);
