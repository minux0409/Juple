namespace Juple.Application.Users.BootstrapCurrentUser;

/// <param name="AuthenticatedAtUtc">
/// When the caller last actually signed in (the verified access token's auth_time), or null when the token carries none.
/// Only consulted to CREATE an account: an existing one is never gated on it. See CurrentUserBootstrapService.
/// </param>
public sealed record BootstrapCurrentUserCommand(string? PreferredLocale, string? TimeZoneId, DateTimeOffset? AuthenticatedAtUtc = null);
