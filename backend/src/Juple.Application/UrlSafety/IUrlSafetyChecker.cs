namespace Juple.Application.UrlSafety;

/// <summary>
/// Isolates whichever external threat-lookup provider is configured (see
/// Juple.Infrastructure.UrlSafety.WebRiskUrlSafetyChecker) from the Application layer - callers
/// depend only on this interface and UrlSafetyResult, never on provider-specific types, request
/// shapes, or credentials. Implementations must never throw for an ordinary "provider unavailable"
/// outcome (timeout, non-success status, malformed response, missing credential) - those all
/// resolve to UrlSafetyResult.Unavailable, matching UrlSafety's "never a hard dependency of saving
/// a URL" principle.
/// </summary>
public interface IUrlSafetyChecker
{
    Task<UrlSafetyResult> CheckAsync(string url, CancellationToken cancellationToken = default);
}
