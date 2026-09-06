using Juple.Domain.Push;

namespace Juple.Api.Push;

/// <summary>Converts the Domain <see cref="PushPlatform"/> enum to/from its lowercase wire value. Mirrors IntervalUnitWireFormat's identical two-way shape.</summary>
public static class PushPlatformWireFormat
{
    public static string ToWireValue(PushPlatform platform) => platform switch
    {
        PushPlatform.Android => "android",
        PushPlatform.Ios => "ios",
        _ => throw new ArgumentOutOfRangeException(nameof(platform), platform, "Unknown PushPlatform."),
    };

    public static bool TryParse(string? value, out PushPlatform platform)
    {
        switch (value?.ToLowerInvariant())
        {
            case "android":
                platform = PushPlatform.Android;
                return true;
            case "ios":
                platform = PushPlatform.Ios;
                return true;
            default:
                platform = default;
                return false;
        }
    }
}
