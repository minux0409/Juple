namespace Juple.Application.UrlSafety;

/// <summary>
/// Normalized across whichever safety provider is configured (see IUrlSafetyChecker) - the
/// Application layer never sees a provider-specific threat type string. <see cref="Other"/> covers
/// any provider-supported category this enum does not explicitly model yet.
/// </summary>
public enum UrlThreatCategory
{
    Malware,
    SocialEngineering,
    UnwantedSoftware,
    Other,
}
