using System.Text.Json;
using Juple.Application.Notifications;

namespace Juple.Api.Notifications;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/notifications. Callers below
/// the API layer (Application, Store) work only with the typed <see cref="NotificationPageCursor"/>
/// - they never see this Base64/JSON wire format. Mirrors RecentlyOpenedItemPageCursorCodec exactly.
/// The payload carries no UserId or other PII; it is not an authorization mechanism.
/// </summary>
public static class NotificationPageCursorCodec
{
    private const int CurrentVersion = 1;

    public static string Encode(NotificationPageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.CreatedAtUtc, cursor.Id);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out NotificationPageCursor? cursor)
    {
        cursor = null;

        try
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            var paddingNeeded = (4 - (base64.Length % 4)) % 4;
            base64 = base64.PadRight(base64.Length + paddingNeeded, '=');

            var json = Convert.FromBase64String(base64);
            var payload = JsonSerializer.Deserialize<CursorPayload>(json);
            if (payload is null || payload.V != CurrentVersion || payload.Id <= 0)
            {
                return false;
            }

            cursor = new NotificationPageCursor(payload.T, payload.Id);
            return true;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    private sealed record CursorPayload(int V, DateTimeOffset T, long Id);
}
