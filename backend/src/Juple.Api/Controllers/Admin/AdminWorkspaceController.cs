using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
using Juple.Application.Billing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Juple.Api.Controllers.Admin;

[ApiController]
[Route("api/v1/admin/workspace")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminWorkspaceController(IAdminWorkspaceStore store, AdminWorkspaceOptions options,
    BillingOptions billing, TimeProvider clock, IMemoryCache cache, IAdminTelemetrySource telemetry) : ControllerBase
{
    private static readonly SemaphoreSlim AggregateSlots = new(1);
    [HttpGet("configuration")]
    public IActionResult Configuration() => Ok(new { options.Enabled, TimeZone = "Asia/Seoul", DefaultRange = "7d", MaxDays = AdminDateRange.MaxDays });
    [HttpGet("overview")]
    public Task<IActionResult> Overview(string? range, DateOnly? from, DateOnly? through, CancellationToken ct) =>
        Read("overview", range, from, through, p => store.OverviewAsync(p, clock.GetUtcNow(), ct), ct);
    [HttpGet("operations")]
    public Task<IActionResult> Operations(string? range, DateOnly? from, DateOnly? through, CancellationToken ct) =>
        Read("operations", range, from, through, async p => {
            var data = await store.OperationsAsync(p, ct);
            var metrics = await telemetry.ReadAsync(p, ct);
            return data with { Telemetry = metrics, Coverage = data.Coverage.Select(x => x.Metric == "apiErrors"
                ? new WorkspaceCoverage(x.Metric, metrics.Available, metrics.Available
                    ? "Application Insights AppRequests 집계. 수집·샘플링 설정에 따른 관측값이며 API 401은 로그인 실패 수가 아닙니다."
                    : $"Azure Monitor 조회 불가: {metrics.Status}. 0건으로 간주하지 않습니다.") : x).ToArray() };
        }, ct);
    [HttpGet("revenue")]
    public Task<IActionResult> Revenue(CancellationToken ct) =>
        Read("revenue", "today", null, null, _ => store.RevenueAsync(billing.ProgramEnabled, ct), ct);

    private Task<IActionResult> Read<T>(string kind, string? range, DateOnly? from, DateOnly? through,
        Func<AdminDateRange, Task<T>> load, CancellationToken ct) => AdminResults.RunAsync(this, async () =>
    {
        // The active-admin policy still runs on EVERY request, including cached aggregate reads.
        Response.Headers.CacheControl = "private, no-store";
        if (!options.Enabled) return NotFound(new { code = "adminWorkspaceDisabled" });
        var period = AdminDateRange.Resolve(range, from, through, clock.GetUtcNow());
        var key = $"admin-workspace:{kind}:{period.From:yyyyMMdd}:{period.Through:yyyyMMdd}";
        if (cache.TryGetValue<T>(key, out var saved)) return Ok(saved);
        if (!await AggregateSlots.WaitAsync(0, ct)) { Response.Headers.RetryAfter = "5"; return StatusCode(429); }
        try
        {
            if (cache.TryGetValue<T>(key, out saved)) return Ok(saved);
            var data = await load(period);
            cache.Set(key, data, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1), Size = 1 });
            return Ok(data);
        }
        finally { AggregateSlots.Release(); }
    });
}
