namespace Juple.Infrastructure.UrlSafety;

/// <summary>
/// A null/empty <see cref="ApiKey"/> is a legitimate, expected state (not yet provisioned in this
/// environment) - WebRiskUrlSafetyChecker treats it as "provider unconfigured" and returns
/// UrlSafetyResult.Unavailable without ever calling out, exactly like Firebase's ServiceAccountKeyJson/
/// NotConfiguredPushSender handles an absent Push credential. Never fail Backend startup over this -
/// URL safety is an optional enrichment, not a hard dependency (see docs on UrlSafety's design).
/// </summary>
public sealed record WebRiskOptions(string? ApiKey);
