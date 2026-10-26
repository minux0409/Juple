using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Api.Configuration;
using Juple.Application.Admin;
using Juple.Domain.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// The Admin Web (admin.juple.co.kr) - read-only overview endpoints. The whole controller is behind the JupleAdmin policy, so a
/// request without a valid token is 401 and a valid token of anyone without an ACTIVE admin grant is 403 before any action runs.
/// Operating an admin tool never depends on the operator's own subscription; the operator is a Juple user and has accepted the
/// current Terms like everyone else (the ordinary Terms rule applies).
/// </summary>
[ApiController]
[Route("api/v1/admin")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
public sealed class AdminController(
    IAdminService adminService,
    IOptions<MobileVersionPolicyOptions> versionPolicy,
    IHostEnvironment hostEnvironment,
    TimeProvider timeProvider) : ControllerBase
{
    /// <summary>Who the Admin Web is talking to: the caller's own internal UserId and role - nothing about anyone else.</summary>
    [HttpGet("me")]
    public IActionResult GetMe()
    {
        var admin = AdminRequestContext.GetRequired(HttpContext);
        return Ok(new AdminMeResponse(admin.UserId, admin.Role.ToString()));
    }

    /// <summary>One request for every dashboard number; todayStartUtc is the admin's own local midnight (default: UTC midnight).</summary>
    [HttpGet("dashboard/summary")]
    public Task<IActionResult> GetDashboardSummaryAsync([FromQuery] DateTimeOffset? todayStartUtc, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await adminService.GetDashboardSummaryAsync(todayStartUtc, cancellationToken)));

    /// <summary>Read-only user directory: newest first, keyset cursor; jupleId is an exact Juple ID (no partial search).</summary>
    [HttpGet("users")]
    public Task<IActionResult> ListUsersAsync([FromQuery] string? jupleId, [FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            var page = await adminService.ListUsersAsync(jupleId, cursor, limit, cancellationToken);
            return Ok(new AdminPageResponse<AdminUserListItem>(page.Items, AdminResults.Cursor(page.NextCursor)));
        });

    /// <summary>분석: every analytics number for the last 7d / 30d / 90d (UTC days; any other range is 400). See docs/analytics.md.</summary>
    [HttpGet("analytics/overview")]
    public Task<IActionResult> GetAnalyticsOverviewAsync([FromQuery] string? range, [FromServices] IAdminAnalyticsService analytics, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await analytics.GetOverviewAsync(range, cancellationToken)));

    /// <summary>One account's saved-link counts per UTC day (7d / 30d / 90d). Counts and identifiers only - no link content. Unknown account = 404.</summary>
    [HttpGet("users/{userId:long}/link-stats")]
    public Task<IActionResult> GetUserLinkStatsAsync(long userId, [FromQuery] string? range, [FromServices] IAdminAnalyticsService analytics, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await analytics.GetUserLinkStatsAsync(userId, range, cancellationToken)));

    /// <summary>
    /// 운영 > 앱 버전: the mobile version policy as the API serves it, read fresh from the database (not the 30 s cache the apps go
    /// through), with where each platform's numbers come from and the token a change must send back.
    /// </summary>
    [HttpGet("operations/app-version")]
    public Task<IActionResult> GetAppVersionAsync([FromServices] MobileVersionPolicyAdminService policies, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await ReadAppVersionAsync(policies, cancellationToken)));

    /// <summary>
    /// Saves ONE platform's latest and minimum supported build (the other platform is untouched). Owner only - a minimum can lock
    /// older builds out of the app. Every rule is checked here: whole numbers 1.., minimum not above latest, the Version the operator
    /// saw (409 appVersionChanged otherwise), and explicit confirmations for raising the minimum or lowering the latest. Unchanged
    /// values write nothing. A save is audited in the same transaction.
    /// </summary>
    [HttpPut("operations/app-version/{platform}")]
    public Task<IActionResult> UpdateAppVersionAsync(
        string platform,
        [FromBody] AdminAppVersionWrite body,
        [FromServices] MobileVersionPolicyAdminService policies,
        [FromServices] MobileVersionPolicySource source,
        CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext);
            if (admin.Role != AdminRole.Owner)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { code = "ownerRequired" });
            }

            var key = MobileVersionPolicyAdminService.Platform(platform);
            var configured = key == MobileVersionPolicySetting.Android ? versionPolicy.Value.Android : versionPolicy.Value.Ios;
            var result = await policies.SaveAsync(
                admin.UserId,
                key,
                new MobileVersionPolicyChange(body.LatestBuild, body.MinimumSupportedBuild, body.Version, body.ConfirmMinimumIncrease, body.ConfirmLatestDecrease),
                new MobileBuildPolicy(configured.LatestBuild, configured.MinimumSupportedBuild),
                cancellationToken);
            if (result.Changed)
            {
                source.Invalidate();
            }

            return Ok(await ReadAppVersionAsync(policies, cancellationToken));
        });

    private async Task<AdminAppVersionResponse> ReadAppVersionAsync(MobileVersionPolicyAdminService policies, CancellationToken cancellationToken)
    {
        var rows = await policies.ListAsync(cancellationToken);
        var effective = MobileVersionPolicySource.Merge(versionPolicy.Value, rows);
        var canEdit = AdminRequestContext.GetRequired(HttpContext).Role == AdminRole.Owner;
        return new AdminAppVersionResponse(
            AdminAppVersionPlatform.From(MobileVersionPolicySetting.Android, effective.Android, versionPolicy.Value.Android, rows, canEdit),
            AdminAppVersionPlatform.From(MobileVersionPolicySetting.Ios, effective.Ios, versionPolicy.Value.Ios, rows, canEdit));
    }

    /// <summary>What this API instance is: environment name, its build version and server time. No configuration values or secrets.</summary>
    [HttpGet("operations/system")]
    public IActionResult GetSystem() =>
        Ok(new AdminSystemResponse(
            hostEnvironment.EnvironmentName,
            typeof(AdminController).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            timeProvider.GetUtcNow()));

    public sealed record AdminMeResponse(long UserId, string Role);

    public sealed record AdminAppVersionResponse(AdminAppVersionPlatform Android, AdminAppVersionPlatform Ios);

    /// <summary>
    /// One platform: the first five fields are exactly what the app-update check serves. Source is "database" (an operator saved it)
    /// or "configuration" (the deployed values, Version null). Configured* are the deployed values a platform without a row uses.
    /// </summary>
    public sealed record AdminAppVersionPlatform(
        string Platform,
        bool Enabled,
        int LatestBuild,
        int MinimumSupportedBuild,
        string? StoreUrl,
        string Source,
        string? Version,
        DateTimeOffset? UpdatedAtUtc,
        long? UpdatedByAdminUserId,
        int ConfiguredLatestBuild,
        int ConfiguredMinimumSupportedBuild,
        bool CanEdit)
    {
        public static AdminAppVersionPlatform From(
            string platform,
            MobilePlatformVersionPolicy effective,
            MobilePlatformVersionPolicy configured,
            IReadOnlyList<StoredMobileVersionPolicy> rows,
            bool canEdit)
        {
            var served = AppUpdateController.AppUpdatePolicyResponse.From(platform, effective);
            var row = rows.FirstOrDefault(candidate => candidate.Platform == platform);
            return new(
                served.Platform,
                served.Enabled,
                served.LatestBuild,
                served.MinimumSupportedBuild,
                served.StoreUrl,
                row is null ? "configuration" : "database",
                row?.Version,
                row?.UpdatedAtUtc,
                row?.UpdatedByAdminUserId,
                configured.LatestBuild,
                configured.MinimumSupportedBuild,
                canEdit);
        }
    }

    /// <summary>A change of one platform. Version is the token from the last read (null/empty while it runs on configuration).</summary>
    public sealed record AdminAppVersionWrite(
        int LatestBuild,
        int MinimumSupportedBuild,
        string? Version,
        bool ConfirmMinimumIncrease = false,
        bool ConfirmLatestDecrease = false);

    public sealed record AdminSystemResponse(string Environment, string? ApiVersion, DateTimeOffset ServerTimeUtc);
}

/// <summary>A keyset page as the Admin Web reads it; nextCursor is opaque text (null at the end).</summary>
public sealed record AdminPageResponse<T>(IReadOnlyList<T> Items, string? NextCursor);

/// <summary>One mapping of the admin service's errors to HTTP for every admin controller.</summary>
internal static class AdminResults
{
    public static async Task<IActionResult> RunAsync(ControllerBase controller, Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (InvalidAdminRequestException exception)
        {
            controller.ModelState.AddModelError(exception.Field, exception.Message);
            return controller.ValidationProblem(controller.ModelState);
        }
        catch (Exception exception) when (exception is AdminInquiryNotFoundException or AdminUserNotFoundException)
        {
            return controller.NotFound();
        }
        catch (MobileVersionPolicyConflictException)
        {
            return controller.Conflict(new { code = "appVersionChanged" });
        }
        catch (UnauthorizedAccessException)
        {
            return controller.Forbid();
        }
    }

    public static string? Cursor(long? value) => value?.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
