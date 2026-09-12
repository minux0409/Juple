namespace Juple.Application.UrlSafety;

/// <summary>
/// Never treat <see cref="NoKnownThreat"/> as a positive safety guarantee - it only means the
/// configured provider found no match in its current threat lists, not that the URL is
/// confirmed safe. <see cref="NotChecked"/> is a client-only state (before a check has even been
/// attempted) and is never returned by the backend - see IUrlSafetyChecker/CheckUrlSafetyService.
/// </summary>
public enum UrlSafetyStatus
{
    ThreatDetected,
    NoKnownThreat,
    CheckUnavailable,
}
