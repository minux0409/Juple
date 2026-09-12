namespace Juple.Application.UrlSafety;

public sealed record UrlSafetyResult(UrlSafetyStatus Status, IReadOnlyList<UrlThreatCategory> Threats)
{
    public static readonly UrlSafetyResult Unavailable =
        new(UrlSafetyStatus.CheckUnavailable, []);
}
