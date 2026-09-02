namespace Juple.Application.Purchases;

/// <summary>
/// Shared Create/Update normalization for the full Purchase field set. ProductName follows
/// Item.Title's trim-then-validate approach but, unlike Title, is required and never collapses to
/// null - it is the only guaranteed way to identify a Purchase once ItemId is null (see
/// database-conventions.md and CK_Purchases_ProductName_NotWhitespaceOnly). Store/Variant are
/// optional display strings normalized the same way Title is: trim, whitespace-only/empty -> null.
/// Memo follows Item.Memo's convention verbatim: only null/"" collapses to null, all other user
/// whitespace/linebreaks are preserved as-is. CurrencyCode is trimmed, uppercased, and validated as
/// an ASCII 3-letter code shape only - no ISO 4217 hardcoded list this round (see
/// product-overview.md). Amount/Quantity are rejected - never silently rounded or truncated - both
/// when they carry more decimal places than the DB column scale allows, and when their magnitude
/// exceeds what the column's total precision can hold; both checks are pure decimal comparisons
/// (no string/locale-dependent parsing), so a value that fits C#'s much larger decimal range but not
/// SQL Server's decimal(19,4)/decimal(18,3) columns is rejected here as a 400 instead of surfacing
/// as a raw arithmetic-overflow SqlException/DbUpdateException (500) from SaveChangesAsync. The
/// exact bounds were verified against a real SQL Server instance, not assumed (see
/// PurchaseStoreIntegrationTests race/precision coverage).
/// </summary>
internal static class PurchaseFieldsNormalizer
{
    private const int AmountMaxScale = 4;
    private const int QuantityMaxScale = 3;

    // decimal(19,4): precision 19, scale 4 -> 15 integer digits + 4 fractional digits.
    private const decimal AmountMax = 999_999_999_999_999.9999m;

    // decimal(18,3): precision 18, scale 3 -> 15 integer digits + 3 fractional digits.
    private const decimal QuantityMax = 999_999_999_999_999.999m;

    internal static PurchaseFields Normalize(
        long? itemId,
        string? productName,
        DateOnly? purchaseDate,
        decimal? amount,
        string? currencyCode,
        string? store,
        string? variant,
        decimal? quantity,
        string? memo)
    {
        var normalizedProductName = NormalizeProductName(productName);
        var normalizedPurchaseDate = purchaseDate
            ?? throw new InvalidPurchaseException("purchaseDate", "purchaseDate is required.");
        var normalizedCurrencyCode = NormalizeAmountAndCurrency(amount, currencyCode);
        NormalizeQuantity(quantity);
        var normalizedStore = NormalizeDisplayString(store, "store", 200);
        var normalizedVariant = NormalizeDisplayString(variant, "variant", 200);
        var normalizedMemo = NormalizeMemo(memo);

        return new PurchaseFields(
            itemId,
            normalizedProductName,
            normalizedPurchaseDate,
            amount,
            normalizedCurrencyCode,
            normalizedStore,
            normalizedVariant,
            quantity,
            normalizedMemo);
    }

    private static string NormalizeProductName(string? productName)
    {
        var trimmed = productName?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new InvalidPurchaseException("productName", "productName is required.");
        }

        if (trimmed.Length > 500)
        {
            throw new InvalidPurchaseException("productName", "productName must be 500 characters or fewer.");
        }

        return trimmed;
    }

    private static string? NormalizeDisplayString(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > maxLength)
        {
            throw new InvalidPurchaseException(field, $"{field} must be {maxLength} characters or fewer.");
        }

        return trimmed;
    }

    private static string? NormalizeMemo(string? memo)
    {
        if (string.IsNullOrEmpty(memo))
        {
            return null;
        }

        if (memo.Length > 4000)
        {
            throw new InvalidPurchaseException("memo", "memo must be 4000 characters or fewer.");
        }

        return memo;
    }

    private static string? NormalizeAmountAndCurrency(decimal? amount, string? currencyCode)
    {
        if (amount is null && currencyCode is null)
        {
            return null;
        }

        if (amount is null || currencyCode is null)
        {
            var missingField = amount is null ? "amount" : "currencyCode";
            throw new InvalidPurchaseException(
                missingField, "amount and currencyCode must both be provided together, or both omitted.");
        }

        if (amount < 0)
        {
            throw new InvalidPurchaseException("amount", "amount must be zero or greater.");
        }

        if (amount > AmountMax)
        {
            throw new InvalidPurchaseException("amount", $"amount must be {AmountMax} or less.");
        }

        if (ExceedsScale(amount.Value, AmountMaxScale))
        {
            throw new InvalidPurchaseException(
                "amount", $"amount must have at most {AmountMaxScale} decimal places.");
        }

        var trimmedCurrencyCode = currencyCode.Trim().ToUpperInvariant();
        if (trimmedCurrencyCode.Length != 3 || !trimmedCurrencyCode.All(c => c is >= 'A' and <= 'Z'))
        {
            throw new InvalidPurchaseException(
                "currencyCode", "currencyCode must be a 3-letter ISO 4217 currency code.");
        }

        return trimmedCurrencyCode;
    }

    private static void NormalizeQuantity(decimal? quantity)
    {
        if (quantity is null)
        {
            return;
        }

        if (quantity <= 0)
        {
            throw new InvalidPurchaseException("quantity", "quantity must be greater than zero.");
        }

        if (quantity > QuantityMax)
        {
            throw new InvalidPurchaseException("quantity", $"quantity must be {QuantityMax} or less.");
        }

        if (ExceedsScale(quantity.Value, QuantityMaxScale))
        {
            throw new InvalidPurchaseException(
                "quantity", $"quantity must have at most {QuantityMaxScale} decimal places.");
        }
    }

    private static bool ExceedsScale(decimal value, int maxScale) => Math.Round(value, maxScale) != value;
}
