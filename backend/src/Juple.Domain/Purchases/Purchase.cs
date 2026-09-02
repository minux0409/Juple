namespace Juple.Domain.Purchases;

/// <summary>
/// A user-entered record of an actual past purchase - itself a historical snapshot, which is why
/// no field here carries a "Snapshot" suffix. Independent of Item: ItemId is optional and is
/// detached (never cascaded away) if the referenced Item is later deleted, so a Purchase always
/// survives as its own historical record. ProductName is required precisely because of that: it
/// is the only guaranteed way to know what this record was for once ItemId is null (whether from
/// the start, or after the Item was deleted) - callers must pass an already-trimmed, non-empty
/// value. Create-only for now: no edit/update methods yet.
/// </summary>
public sealed class Purchase
{
    private Purchase()
    {
    }

    public Purchase(
        long userId,
        long? itemId,
        DateOnly purchaseDate,
        string productName,
        decimal? amount,
        string? currencyCode,
        string? store,
        string? variant,
        decimal? quantity,
        string? memo,
        DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        ItemId = itemId;
        PurchaseDate = purchaseDate;
        ProductName = productName;
        Amount = amount;
        CurrencyCode = currencyCode;
        Store = store;
        Variant = variant;
        Quantity = quantity;
        Memo = memo;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public long? ItemId { get; private set; }

    public DateOnly PurchaseDate { get; private set; }

    public string ProductName { get; private set; } = null!;

    public decimal? Amount { get; private set; }

    public string? CurrencyCode { get; private set; }

    public string? Store { get; private set; }

    public string? Variant { get; private set; }

    public decimal? Quantity { get; private set; }

    public string? Memo { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>
    /// Full replacement of every user-editable field. Callers must pass already-normalized values,
    /// and must have already verified ownership of a non-null itemId. CreatedAtUtc is deliberately
    /// not a parameter here - it is set once at creation and never changes.
    /// </summary>
    public void Update(
        long? itemId,
        DateOnly purchaseDate,
        string productName,
        decimal? amount,
        string? currencyCode,
        string? store,
        string? variant,
        decimal? quantity,
        string? memo)
    {
        ItemId = itemId;
        PurchaseDate = purchaseDate;
        ProductName = productName;
        Amount = amount;
        CurrencyCode = currencyCode;
        Store = store;
        Variant = variant;
        Quantity = quantity;
        Memo = memo;
    }
}
