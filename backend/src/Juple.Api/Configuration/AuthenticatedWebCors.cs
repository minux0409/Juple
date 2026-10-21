using Microsoft.AspNetCore.Cors.Infrastructure;

namespace Juple.Api.Configuration;

/// <summary>
/// CORS for the signed-in Juple Web app (a browser SPA on its own origin calling this API with a bearer token). The DEFAULT
/// policy, so it covers the authenticated API surface; the anonymous Public API keeps its own narrower PublicWeb policy (its
/// controller's [EnableCors] wins over the default).
///
/// Only the explicitly configured origins (AuthenticatedWeb:AllowedOrigins - e.g. http://localhost:3000 locally, the Web app's own
/// host per environment), never AllowAnyOrigin, and never credentials: the bearer token is sent in the Authorization header, so
/// no cookie ever needs to cross origins. Nothing configured = no cross-origin browser access at all, exactly as before.
/// </summary>
public static class AuthenticatedWebCors
{
    public const string AllowedOriginsSection = "AuthenticatedWeb:AllowedOrigins";

    public static readonly IReadOnlyList<string> AllowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

    /// <summary>
    /// The bearer token, JSON bodies, and the Collection unlock grant (the short-lived token from POST {id}/unlock, which a locked
    /// Collection's reads and writes require - CollectionsController.UnlockTokenHeader). Explicit names only, never any header.
    /// </summary>
    public static readonly IReadOnlyList<string> AllowedHeaders = ["Authorization", "Content-Type", Controllers.CollectionsController.UnlockTokenHeader];

    /// <summary>How long a browser may cache a preflight answer.</summary>
    public static readonly TimeSpan PreflightMaxAge = TimeSpan.FromMinutes(10);

    /// <summary>
    /// The configured origins, normalized to scheme://host[:port] (a trailing slash is dropped). A wildcard, a relative value or one
    /// with a path / query / fragment is a configuration mistake: it stops startup naming the value rather than widening access.
    /// </summary>
    public static IReadOnlyList<string> NormalizeOrigins(IEnumerable<string?> configured)
    {
        var origins = new List<string>();
        foreach (var raw in configured)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            var value = raw.Trim();
            if (value.Contains('*', StringComparison.Ordinal)
                || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
                || uri.AbsolutePath != "/"
                || !string.IsNullOrEmpty(uri.Query)
                || !string.IsNullOrEmpty(uri.Fragment)
                || !string.IsNullOrEmpty(uri.UserInfo))
            {
                throw new InvalidOperationException(
                    $"{AllowedOriginsSection} must contain only absolute http(s) origins (scheme://host[:port], no wildcard or path) - got '{value}'.");
            }

            var origin = uri.GetLeftPart(UriPartial.Authority);
            if (!origins.Contains(origin, StringComparer.OrdinalIgnoreCase))
            {
                origins.Add(origin);
            }
        }

        return origins;
    }

    /// <summary>The policy for those origins - empty origins give a policy that allows no cross-origin request.</summary>
    public static CorsPolicy BuildPolicy(IReadOnlyList<string> origins)
    {
        var builder = new CorsPolicyBuilder();
        if (origins.Count > 0)
        {
            builder
                .WithOrigins([.. origins])
                .WithMethods([.. AllowedMethods])
                .WithHeaders([.. AllowedHeaders])
                .WithExposedHeaders("Retry-After")
                .SetPreflightMaxAge(PreflightMaxAge);
        }

        return builder.Build();
    }
}
