namespace Juple.Application.Collections.Locking;

/// <summary>
/// "The user signed in again just now" - required to replace the lock password without knowing it.
/// Decided only from the server-verified authentication instant of the current access token (see
/// Juple.Api AuthenticationTimeClaim); never from a client flag or a client clock, and never from
/// the token's iat (a refreshed token has a new iat without a new sign-in, and DEV measurements
/// showed a fresh token's iat itself lagging by minutes).
/// </summary>
public static class RecentAuthentication
{
    public static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);

    /// <summary>How far in the future (server clock) an authentication instant may be - clock skew only.</summary>
    public static readonly TimeSpan AllowedFutureSkew = TimeSpan.FromSeconds(60);

    public static void Require(DateTimeOffset? authenticatedAtUtc, DateTimeOffset nowUtc)
    {
        if (authenticatedAtUtc is not { } instant
            || instant > nowUtc + AllowedFutureSkew
            || nowUtc - instant > MaxAge)
        {
            throw new RecentAuthenticationRequiredException();
        }
    }
}

/// <summary>The current sign-in is missing, too old or implausible for a password reset.</summary>
public sealed class RecentAuthenticationRequiredException()
    : Exception("A recent sign-in is required for this action.");

/// <summary>The user has no Collection lock password yet (set one first).</summary>
public sealed class CollectionLockPasswordNotConfiguredException()
    : Exception("No Collection lock password is configured.");
