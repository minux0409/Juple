using Juple.Domain.Purchases;

namespace Juple.Api.RepeatPurchases;

/// <summary>
/// Converts the Domain <see cref="IntervalUnit"/> enum to/from its lowercase wire value. The
/// numeric DB/enum value is never exposed on the API - mirrors ItemStateWireFormat, but (unlike
/// that one-way class) needs both directions since RepeatPurchase both accepts intervalUnit on
/// Create/Update and returns it on every read.
/// </summary>
public static class IntervalUnitWireFormat
{
    public static string ToWireValue(IntervalUnit intervalUnit) => intervalUnit switch
    {
        IntervalUnit.Day => "day",
        IntervalUnit.Week => "week",
        IntervalUnit.Month => "month",
        _ => throw new ArgumentOutOfRangeException(nameof(intervalUnit), intervalUnit, "Unknown IntervalUnit."),
    };

    public static bool TryParse(string? value, out IntervalUnit intervalUnit)
    {
        switch (value?.ToLowerInvariant())
        {
            case "day":
                intervalUnit = IntervalUnit.Day;
                return true;
            case "week":
                intervalUnit = IntervalUnit.Week;
                return true;
            case "month":
                intervalUnit = IntervalUnit.Month;
                return true;
            default:
                intervalUnit = default;
                return false;
        }
    }
}
