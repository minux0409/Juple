using System.Text.Json;
using Juple.Application.Items;

namespace Juple.Api.Items;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/items. Callers below the API
/// layer (Application, Store) work only with the typed <see cref="ItemPageCursor"/> - they never
/// see this Base64/JSON wire format. The payload carries no UserId, URL, token, or other PII;
/// it is not an authorization mechanism.
/// </summary>
public static class ItemPageCursorCodec
{
    private const int CurrentVersion = 1;

    public static string Encode(ItemPageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.StateChangedAtUtc, cursor.Id);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out ItemPageCursor? cursor)
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

            cursor = new ItemPageCursor(payload.T, payload.Id);
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
