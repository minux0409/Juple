using System.Text.Json;
using Juple.Application.Collections;

namespace Juple.Api.Collections;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/collections - mirrors
/// ItemHistoryPageCursorCodec/CollectionItemPageCursorCodec exactly (same Base64url/JSON wire
/// format), kept as its own type rather than reusing either since all three are independent
/// pagination contracts (Collection.CreatedAtUtc/Id vs CollectionItem.AddedAtUtc/ItemId vs
/// Item.SavedAtUtc/Id) that must never be interchangeable, even though they share the same
/// on-wire shape today. The payload carries no UserId, URL, token, or other PII; it is not an
/// authorization mechanism.
/// </summary>
public static class CollectionPageCursorCodec
{
    private const int CurrentVersion = 1;

    public static string Encode(CollectionPageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.CreatedAtUtc, cursor.Id);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out CollectionPageCursor? cursor)
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

            cursor = new CollectionPageCursor(payload.T, payload.Id);
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
