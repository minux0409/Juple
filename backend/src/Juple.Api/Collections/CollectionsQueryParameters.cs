using Juple.Application.Collections;

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

    /// <summary>
    /// A Collection's link order: missing is the original manual order; otherwise exactly
    /// "dateDesc", "dateAsc", "nameAsc" or "nameDesc" (any case; the name orders are for link search only). Anything else is invalid - never silently ignored.
    /// </summary>
    public static bool TryParseItemSort(string? value, out CollectionItemSort sort)
    {
        switch (value?.ToLowerInvariant())
        {
            case null:
                sort = CollectionItemSort.Manual;
                return true;
            case "datedesc":
                sort = CollectionItemSort.DateDesc;
                return true;
            case "dateasc":
                sort = CollectionItemSort.DateAsc;
                return true;
            case "nameasc":
                sort = CollectionItemSort.NameAsc;
                return true;
            case "namedesc":
                sort = CollectionItemSort.NameDesc;
                return true;
            default:
                sort = default;
                return false;
        }
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
