namespace Juple.Application.Purchases;

public sealed record PurchaseDto(
    long Id,
    long? ItemId,
    string ProductName,
    DateOnly PurchaseDate,
    decimal? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    decimal? Quantity,
    string? Memo,
    DateTimeOffset CreatedAtUtc);
