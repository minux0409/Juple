using Juple.Application.Analytics;
using Juple.Application.Identity;
using Juple.Domain.Analytics;
using Juple.Infrastructure.Analytics;
using Microsoft.Identity.Web;

namespace Juple.Api.Analytics;

/// <summary>
/// After every request: if it was a signed-in Juple person using the product, tell <see cref="UserActivityPump"/> (an in-memory,
/// non-blocking call - no database work on the request path). Runs after the endpoint, so it never changes a response, and it never
/// throws into the pipeline.
/// </summary>
public sealed class UserActivityMiddleware(RequestDelegate next, UserActivityPump pump, ILogger<UserActivityMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        await next(context);
        try
        {
            if (UserActivityRequest.TryClassify(context, out var identity, out var platform, out var appBuild))
            {
                pump.Observe(identity, platform, appBuild);
            }
        }
        catch (Exception exception)
        {
            logger.LogWarning("analytics.activity.observe_failed Error={ErrorType}", exception.GetType().Name);
        }
    }
}

/// <summary>Which requests are product activity (pure - unit-tested with a plain HttpContext).</summary>
public static class UserActivityRequest
{
    public static bool TryClassify(HttpContext context, out ExternalIdentityPrincipal identity, out ClientPlatform platform, out string? appBuild)
    {
        identity = null!;
        platform = ClientPlatform.Unknown;
        appBuild = null;

        // Only the authenticated API surface counts. The Admin Web operating Juple is not using it, and a 401 has no person.
        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api/v1", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/v1/admin", StringComparison.OrdinalIgnoreCase)
            || context.Response.StatusCode == StatusCodes.Status401Unauthorized
            || context.User.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        // Who it was comes only from the validated token (tid + oid), never from a header or the body.
        if (!Guid.TryParse(context.User.GetTenantId(), out var tenantId) || !Guid.TryParse(context.User.GetObjectId(), out var objectId))
        {
            return false;
        }

        identity = new ExternalIdentityPrincipal(tenantId, objectId);
        platform = ClientPlatformDetector.Detect(
            context.Request.Headers[ClientPlatformDetector.PlatformHeader].ToString(),
            context.Request.Headers.UserAgent.ToString());
        appBuild = platform is ClientPlatform.Android or ClientPlatform.Ios
            ? ClientPlatformDetector.NormalizeAppBuild(context.Request.Headers[ClientPlatformDetector.AppBuildHeader].ToString())
            : null;
        return true;
    }
}

/// <summary>Hosts <see cref="UserActivityPump"/>'s writer loop (HTTP API only).</summary>
public sealed class UserActivityRecorderService(UserActivityPump pump) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => pump.RunAsync(stoppingToken);
}
