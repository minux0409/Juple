using System.Globalization;
using System.Security.Claims;

namespace Juple.Api.Authentication;

/// <summary>
/// Reads when the caller last actually signed in (the access token's <c>auth_time</c>, added as an
/// optional claim on the Juple API app registration). The principal is the JWT bearer handler's
/// output, so the value comes from a signature-validated token - never from anything the client
/// sends alongside it. Measured on real DEV sign-ins (see infra/azure/README.md): a refresh keeps the
/// original value; only an interactive prompt=login sign-in moves it.
/// </summary>
public static class AuthenticationTimeClaim
{
    // Largest Unix second DateTimeOffset can represent (9999-12-31T23:59:59Z).
    private const long MaxUnixSeconds = 253_402_300_799;

    /// <returns>The authentication instant, or null when the claim is missing or not a plain Unix timestamp.</returns>
    public static DateTimeOffset? Read(ClaimsPrincipal principal)
    {
        // Either spelling: the raw JWT name, or the WS-* type a mapping JWT handler renames it to.
        var value = principal.FindFirst("auth_time")?.Value
            ?? principal.FindFirst(ClaimTypes.AuthenticationInstant)?.Value;
        return long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            && seconds is > 0 and <= MaxUnixSeconds
                ? DateTimeOffset.FromUnixTimeSeconds(seconds)
                : null;
    }
}
