namespace Juple.Api.Collections;

/// <summary>
/// Parses/validates the `limit` and `itemId` query parameters for the Collections endpoints -
/// mirrors ItemsQueryParameters/PurchasesQueryParameters. `limit` never silently clamps
/// out-of-range values.
/// </summary>
public static class CollectionsQueryParameters
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
}
