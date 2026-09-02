namespace Juple.Api.RepeatPurchases;

/// <summary>
/// Parses/validates the `limit`, `itemId`, and `includeDisabled` query parameters for
/// GET /api/v1/repeat-purchases. `limit` never silently clamps out-of-range values, mirroring
/// PurchasesQueryParameters exactly (including reusing the same default/min/max).
/// </summary>
public static class RepeatPurchasesQueryParameters
{
    public const int DefaultLimit = 50;
    public const int MinLimit = 1;
    public const int MaxLimit = 100;

    public static bool TryParseLimit(int? value, out int limit)
    {
        if (value is null)
        {
            limit = DefaultLimit;
            return true;
        }

        if (value < MinLimit || value > MaxLimit)
        {
            limit = default;
            return false;
        }

        limit = value.Value;
        return true;
    }

    /// <summary>A missing `itemId` is valid (no filter) and returns null; a present one must be positive.</summary>
    public static bool TryParseItemId(long? value, out long? itemId)
    {
        if (value is null)
        {
            itemId = null;
            return true;
        }

        if (value <= 0)
        {
            itemId = null;
            return false;
        }

        itemId = value;
        return true;
    }

    /// <summary>
    /// A plain include-flag, not a value that can be malformed in a way worth rejecting - absent or
    /// anything other than exactly "true" (case-insensitive) means false.
    /// </summary>
    public static bool ParseIncludeDisabled(string? value) =>
        string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);
}
