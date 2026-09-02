using System.Text.Json;
using Juple.Application.RepeatPurchases;

namespace Juple.Api.RepeatPurchases;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/repeat-purchases. Callers below
/// the API layer (Application, Store) work only with the typed
/// <see cref="RepeatPurchasePageCursor"/> - they never see this Base64/JSON wire format. Mirrors
/// PurchasePageCursorCodec exactly, with the DateOnly payload field renamed to match
/// RepeatPurchasePageCursor's NextPurchaseDate.
/// </summary>
public static class RepeatPurchasePageCursorCodec
{
    private const int CurrentVersion = 1;

    public static string Encode(RepeatPurchasePageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.NextPurchaseDate, cursor.Id);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out RepeatPurchasePageCursor? cursor)
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

            cursor = new RepeatPurchasePageCursor(payload.Date, payload.Id);
            return true;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    private sealed record CursorPayload(int V, DateOnly Date, long Id);
}
