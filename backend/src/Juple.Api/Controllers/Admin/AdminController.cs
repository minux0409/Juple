using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Api.Configuration;
using Juple.Application.Admin;
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

    /// <summary>The mobile version policy as the API serves it (read-only - changing it is a configuration deployment).</summary>
    [HttpGet("operations/app-version")]
    public IActionResult GetAppVersion()
    {
        var options = versionPolicy.Value;
        return Ok(new AdminAppVersionResponse(
            AppUpdateController.AppUpdatePolicyResponse.From("android", options.Android),
            AppUpdateController.AppUpdatePolicyResponse.From("ios", options.Ios)));
    }

    /// <summary>What this API instance is: environment name, its build version and server time. No configuration values or secrets.</summary>
    [HttpGet("operations/system")]
    public IActionResult GetSystem() =>
        Ok(new AdminSystemResponse(
            hostEnvironment.EnvironmentName,
            typeof(AdminController).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            timeProvider.GetUtcNow()));

    public sealed record AdminMeResponse(long UserId, string Role);

    public sealed record AdminAppVersionResponse(AppUpdateController.AppUpdatePolicyResponse Android, AppUpdateController.AppUpdatePolicyResponse Ios);

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
        catch (AdminInquiryNotFoundException)
        {
            return controller.NotFound();
        }
    }

    public static string? Cursor(long? value) => value?.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
