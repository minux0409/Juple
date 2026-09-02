namespace Juple.Api.RepeatPurchases;

/// <summary>
/// Encodes/decodes the opaque `version` field on the RepeatPurchase wire contract. The raw
/// RowVersion byte[]/name is never exposed - callers below the API layer (Application, Store) work
/// only with the typed byte[] value itself. SQL Server's rowversion column type is always exactly
/// 8 bytes, so anything else decodes successfully as Base64 but is still rejected as an invalid
/// version token.
/// </summary>
public static class RepeatPurchaseVersionCodec
{
    private const int RowVersionByteLength = 8;

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static bool TryDecode(string value, out byte[]? version)
    {
        version = null;

        try
        {
            var decoded = Convert.FromBase64String(value);
            if (decoded.Length != RowVersionByteLength)
            {
                return false;
            }

            version = decoded;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
