using System.Text.Json;
using System.Text.Json.Serialization;
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

    // A date-ordered position (see CollectionItemPageCursor.ForDate): its own version, carrying which
    // date order it belongs to and the AddedAtUtc/ItemId keyset. Manual cursors keep version 2's exact
    // wire shape, so what older clients hold and send is unchanged.
    private const int DateVersion = 3;
    private const string DateDescWire = "dateDesc";
    private const string DateAscWire = "dateAsc";

    // A name-ordered position (link search only): the date cursor fields plus the name bucket and key.
    private const int NameVersion = 4;
    private const string NameAscWire = "nameAsc";
    private const string NameDescWire = "nameDesc";

    public static string Encode(CollectionItemPageCursor cursor)
    {
        var payload = cursor.Sort switch
        {
            CollectionItemSort.DateDesc => new CursorPayload(DateVersion, 0, cursor.ItemId, DateDescWire, cursor.AddedAtUtc),
            CollectionItemSort.DateAsc => new CursorPayload(DateVersion, 0, cursor.ItemId, DateAscWire, cursor.AddedAtUtc),
            CollectionItemSort.NameAsc or CollectionItemSort.NameDesc => new CursorPayload(
                NameVersion, 0, cursor.ItemId, cursor.Sort == CollectionItemSort.NameAsc ? NameAscWire : NameDescWire,
                cursor.AddedAtUtc, cursor.NameBucket, cursor.NameKey),
            _ => new CursorPayload(CurrentVersion, cursor.SortOrder, cursor.ItemId),
        };
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
            if (payload is null || payload.ItemId <= 0)
            {
                return false;
            }

            if (payload.V == CurrentVersion && payload.O is null && payload.T is null)
            {
                cursor = new CollectionItemPageCursor(payload.S, payload.ItemId);
                return true;
            }

            if (payload.V == DateVersion && payload.T is { } addedAtUtc)
            {
                var sort = payload.O switch
                {
                    DateDescWire => CollectionItemSort.DateDesc,
                    DateAscWire => CollectionItemSort.DateAsc,
                    _ => (CollectionItemSort?)null,
                };
                if (sort is { } dateSort)
                {
                    cursor = CollectionItemPageCursor.ForDate(dateSort, addedAtUtc, payload.ItemId);
                    return true;
                }
            }

            if (payload.V == NameVersion && payload.T is { } nameAddedAtUtc
                && payload.B is { } bucket and >= 0 and <= 1 && payload.K is { } key)
            {
                var sort = payload.O switch
                {
                    NameAscWire => CollectionItemSort.NameAsc,
                    NameDescWire => CollectionItemSort.NameDesc,
                    _ => (CollectionItemSort?)null,
                };
                if (sort is { } nameSort)
                {
                    cursor = CollectionItemPageCursor.ForName(nameSort, nameAddedAtUtc, payload.ItemId, bucket, key);
                    return true;
                }
            }

            return false;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException)
        {
            return false;
        }
    }

    // O (order) and T (AddedAtUtc) are present only in a date cursor, and omitted from a manual one.
    private sealed record CursorPayload(
        int V,
        int S,
        long ItemId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? O = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? T = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? B = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? K = null);
}
