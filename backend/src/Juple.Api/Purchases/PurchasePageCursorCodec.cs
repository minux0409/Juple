using System.Text.Json;
using Juple.Application.Purchases;

namespace Juple.Api.Purchases;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/purchases. Callers below the
/// API layer (Application, Store) work only with the typed <see cref="PurchasePageCursor"/> - they
/// never see this Base64/JSON wire format. The payload carries no UserId, ProductName, or other
/// PII; it is not an authorization mechanism. Mirrors ItemPageCursorCodec exactly, with the
/// DateTimeOffset payload field swapped for a DateOnly one to match PurchasePageCursor.
/// </summary>
public static class PurchasePageCursorCodec
{
    private const int CurrentVersion = 1;

    public static string Encode(PurchasePageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.PurchaseDate, cursor.Id);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out PurchasePageCursor? cursor)
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

            cursor = new PurchasePageCursor(payload.Date, payload.Id);
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
