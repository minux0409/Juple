using Juple.Domain.Push;

namespace Juple.Api.Push;

/// <summary>
/// The optional <c>apnsEnvironment</c> of an iOS registration: exactly the values of the app's <c>aps-environment</c> entitlement,
/// "development" (Xcode builds - sandbox gateway) or "production" (TestFlight / App Store). Absent means production.
/// </summary>
public static class ApnsEnvironmentWireFormat
{
    public static string ToWireValue(ApnsEnvironment environment) => environment switch
    {
        ApnsEnvironment.Production => "production",
        ApnsEnvironment.Development => "development",
        _ => throw new ArgumentOutOfRangeException(nameof(environment), environment, "Unknown ApnsEnvironment."),
    };

    /// <summary>Null/empty is "not given" (true, null); anything other than the two values is invalid (false).</summary>
    public static bool TryParse(string? value, out ApnsEnvironment? environment)
    {
        switch (value?.Trim().ToLowerInvariant())
        {
            case null or "":
                environment = null;
                return true;
            case "production":
                environment = ApnsEnvironment.Production;
                return true;
            case "development":
                environment = ApnsEnvironment.Development;
                return true;
            default:
                environment = null;
                return false;
        }
    }
}
