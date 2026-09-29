using System.Security.Claims;

namespace Juple.Api.Authentication;

/// <summary>
/// How the caller signed in, read from the signature-validated access token - Juple stores no
/// password and no provider record of its own (ExternalIdentity holds only tenant + object id).
///
/// Entra External ID emits the <c>idp</c> claim only when the user was authenticated by an
/// identity provider other than the tenant itself; a local (email + password / email one-time
/// passcode) account has no <c>idp</c>, or one equal to the token issuer. DEV has only the
/// "Email with password" provider on its user flow (see infra/azure/README.md), so "email" is
/// the only value measured. The Google/Apple values below follow Entra's documented federation
/// idp values and are NOT TESTED - anything else is "unknown" (the app then offers no password
/// management at all rather than guessing).
/// </summary>
public static class SignInMethodClaim
{
    public const string Email = "email";
    public const string Google = "google";
    public const string Apple = "apple";
    public const string Unknown = "unknown";

    public static string Read(ClaimsPrincipal principal)
    {
        var idp = principal.FindFirst("idp")?.Value
            ?? principal.FindFirst("http://schemas.microsoft.com/identity/claims/identityprovider")?.Value;
        if (string.IsNullOrWhiteSpace(idp))
        {
            return Email;
        }

        var issuer = principal.FindFirst("iss")?.Value;
        if (issuer is not null && string.Equals(idp, issuer, StringComparison.OrdinalIgnoreCase))
        {
            return Email;
        }

        return HostOf(idp) switch
        {
            "google.com" or "accounts.google.com" => Google,
            "apple.com" or "appleid.apple.com" => Apple,
            _ => Unknown,
        };
    }

    private static string HostOf(string idp) =>
        Uri.TryCreate(idp, UriKind.Absolute, out var uri) ? uri.Host.ToLowerInvariant() : idp.Trim().ToLowerInvariant();
}
