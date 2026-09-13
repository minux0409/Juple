using System.Text.Json;
using Juple.Application.Collections;

namespace Juple.Api.Collections;

/// <summary>
/// Encodes/decodes the opaque `cursor` query value for GET /api/v1/collections/{id}/items -
/// mirrors ItemHistoryPageCursorCodec exactly (same Base64url/JSON wire format), kept as its own
/// type rather than reusing ItemHistoryPageCursorCodec since the two are independent pagination
/// contracts (SavedAtUtc/Id vs AddedAtUtc/ItemId) that must never be interchangeable, even though
/// they happen to share the same on-wire shape today. The payload carries no UserId, URL, token,
/// or other PII; it is not an authorization mechanism.
/// </summary>
public static class CollectionItemPageCursorCodec
{
    // Bumped from 1: the payload's second field changed meaning from AddedAtUtc to SortOrder (see
    // CollectionItemPageCursor) when Category reorder shipped - an old-shape cursor decoded under
    // the new version check fails closed (TryDecode returns false) rather than being silently
    // misinterpreted as a SortOrder value.
    private const int CurrentVersion = 2;

    public static string Encode(CollectionItemPageCursor cursor)
    {
        var payload = new CursorPayload(CurrentVersion, cursor.SortOrder, cursor.ItemId);
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(json)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static bool TryDecode(string value, out CollectionItemPageCursor? cursor)
    {
        cursor = null;

        try
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            var paddingNeeded = (4 - (base64.Length % 4)) % 4;
            base64 = base64.PadRight(base64.Length + paddingNeeded, '=');

            var json = Convert.FromBase64String(base64);
            var payload = JsonSerializer.Deserialize<CursorPayload>(json);
            if (payload is null || payload.V != CurrentVersion || payload.ItemId <= 0)
            {
                return false;
            }

            cursor = new CollectionItemPageCursor(payload.S, payload.ItemId);
            return true;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    private sealed record CursorPayload(int V, int S, long ItemId);
}
