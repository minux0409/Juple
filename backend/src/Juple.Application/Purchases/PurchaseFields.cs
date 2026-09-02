namespace Juple.Application.Purchases;

/// <summary>
/// Normalized Purchase field values, shared by Create and Update against IPurchaseStore. Callers
/// must have already validated/normalized every field - see PurchaseFieldsNormalizer.
/// </summary>
public sealed record PurchaseFields(
    long? ItemId,
    string ProductName,
    DateOnly PurchaseDate,
    decimal? Amount,
    string? CurrencyCode,
    string? Store,
    string? Variant,
    decimal? Quantity,
    string? Memo);
