namespace Juple.Api.Items;

/// <summary>Parses/validates the `limit` query parameter shared by the Items endpoints.</summary>
public static class ItemsQueryParameters
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
}
