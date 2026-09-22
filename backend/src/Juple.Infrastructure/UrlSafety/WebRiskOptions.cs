namespace Juple.Infrastructure.UrlSafety;

/// <summary>
/// Supplied through UrlSafety:WebRisk:ApiKey (environment: UrlSafety__WebRisk__ApiKey).
/// Missing credentials do not prevent startup, but checks return Unavailable and new URL saves fail closed.
/// Never store credentials in source control.
/// </summary>
public sealed record WebRiskOptions(string? ApiKey);
