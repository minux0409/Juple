using System.Globalization;

namespace Juple.Api.Purchases;

/// <summary>
/// Formats a decimal Amount/Quantity for the wire as a plain, culture-independent decimal string -
/// never through double/JS Number, so a value like 999999999999999.9999 (valid in decimal(19,4),
/// but not exactly representable as an IEEE 754 double) round-trips exactly. decimal.ToString never
/// emits scientific notation, so the only adjustment needed is trimming the trailing zeros the DB
/// column's fixed scale pads on (e.g. 19900.0000 -> "19900") - the scale itself is not semantic,
/// only the value is.
/// </summary>
public static class PurchaseDecimalFormat
{
    public static string? Format(decimal? value)
    {
        if (value is null)
        {
            return null;
        }

        var text = value.Value.ToString(CultureInfo.InvariantCulture);
        if (!text.Contains('.'))
        {
            return text;
        }

        text = text.TrimEnd('0');
        return text.EndsWith('.') ? text[..^1] : text;
    }
}
