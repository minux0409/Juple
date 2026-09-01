using Juple.Domain.Items;

namespace Juple.Api.Items;

/// <summary>
/// Parses/validates the `state` and `limit` query parameters for GET /api/v1/items. `state`
/// never accepts the raw DB numeric value or "inbox" (Daily Inbox has its own date-based
/// GET /api/v1/inbox); `limit` never silently clamps out-of-range values.
/// </summary>
public static class ItemsQueryParameters
{
    public const int DefaultLimit = 50;
    public const int MinLimit = 1;
    public const int MaxLimit = 100;

    public static bool TryParseState(string? value, out ItemState state)
    {
        switch (value?.ToLowerInvariant())
        {
            case "wishlist":
                state = ItemState.Wishlist;
                return true;
            case "archived":
                state = ItemState.Archived;
                return true;
            default:
                state = default;
                return false;
        }
    }

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

    public static bool TryParseCategoryId(string? value, out long? categoryId)
    {
        if (string.IsNullOrEmpty(value))
        {
            categoryId = null;
            return true;
        }

        if (long.TryParse(value, out var parsedCategoryId) && parsedCategoryId > 0)
        {
            categoryId = parsedCategoryId;
            return true;
        }

        categoryId = null;
        return false;
    }
}
