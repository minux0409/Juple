namespace Juple.Application.UrlSafety;

public sealed class UrlSafetyCheckException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    public static void ThrowIfNotAllowed(UrlSafetyResult result)
    {
        if (result.Status == UrlSafetyStatus.ThreatDetected)
            throw new UrlSafetyCheckException("unsafe_url", "This URL cannot be saved because a threat was detected.");
        if (result.Status != UrlSafetyStatus.NoKnownThreat)
            throw new UrlSafetyCheckException("url_safety_check_unavailable", "URL safety could not be checked. Please try again later.");
    }
}
