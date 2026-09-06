namespace Juple.Api.Notifications;

/// <summary>Parses/validates the `limit` query parameter for GET /api/v1/notifications.</summary>
public static class NotificationsQueryParameters
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
