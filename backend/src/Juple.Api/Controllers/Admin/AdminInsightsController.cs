using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// The Admin Web's 대시보드 and 사용자 screens: three dashboard numbers with one chart each, the searchable user table and one
/// person's saving history. Read-only SQL aggregates (AdminInsightsStore); the JupleAdmin policy runs on every request, cached or not.
/// Dashboard reads are cached for a short time per replica and at most one uncached aggregate runs at once (429 + Retry-After).
/// </summary>
[ApiController]
[Route("api/v1/admin")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminInsightsController(AdminInsightsService insights, IMemoryCache cache, TimeProvider clock) : ControllerBase
{
    private static readonly SemaphoreSlim AggregateSlots = new(1);
    private static readonly TimeSpan KpiCacheDuration = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan SeriesCacheDuration = TimeSpan.FromMinutes(1);

    /// <summary>전체 사용자 수 / 전체 저장 링크 수 / 오늘(KST) 신규 가입자 수.</summary>
    [HttpGet("dashboard/kpis")]
    public Task<IActionResult> KpisAsync(CancellationToken cancellationToken) =>
        CachedAsync($"admin-insights:kpis:{AdminDateRange.SeoulDate(clock.GetUtcNow()):yyyyMMdd}", KpiCacheDuration, () => insights.KpisAsync(cancellationToken), cancellationToken);

    /// <summary>metric = users (cumulative accounts) | links (links not in the trash) | signups (per day); range 7d/30d/90d or from+through.</summary>
    [HttpGet("dashboard/series")]
    public Task<IActionResult> SeriesAsync([FromQuery] string? metric, [FromQuery] string? range, [FromQuery] DateOnly? from, [FromQuery] DateOnly? through, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            // Validates before the cache key is built, so an invalid request never occupies a slot.
            var period = AdminDateRange.Resolve(range, from, through, clock.GetUtcNow());
            if (metric is null || !AdminInsightsService.Metrics.Contains(metric, StringComparer.Ordinal))
            {
                throw new InvalidAdminRequestException("metric", "Choose users, links or signups.");
            }

            return await CachedAsync(
                $"admin-insights:series:{metric}:{period.From:yyyyMMdd}:{period.Through:yyyyMMdd}",
                SeriesCacheDuration,
                () => insights.SeriesAsync(metric, null, period.From, period.Through, cancellationToken),
                cancellationToken);
        });

    /// <summary>
    /// The 사용자 table: search (searchField jupleId = a prefix of the Juple ID, nickname = part of the nickname), language = primary
    /// subtag of the sign-up locale, sort createdDesc | createdAsc | linksDesc | linksAsc, page (1-based) and pageSize (max 100).
    /// </summary>
    [HttpGet("users/directory")]
    public Task<IActionResult> UsersAsync(
        [FromQuery] string? search,
        [FromQuery] string? searchField,
        [FromQuery] string? language,
        [FromQuery] string? sort,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await insights.UsersAsync(search, searchField, language, sort, page, pageSize, cancellationToken)));

    /// <summary>One person's links saved per KST day (or month) from their sign-up day to today. Unknown account = 404.</summary>
    [HttpGet("users/{userId:long}/link-history")]
    public Task<IActionResult> LinkHistoryAsync(long userId, [FromQuery] string? granularity, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await insights.UserLinkHistoryAsync(userId, granularity, cancellationToken)));

    private Task<IActionResult> CachedAsync<T>(string key, TimeSpan duration, Func<Task<T>> load, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            Response.Headers.CacheControl = "private, no-store";
            if (cache.TryGetValue<T>(key, out var saved))
            {
                return Ok(saved);
            }

            if (!await AggregateSlots.WaitAsync(TimeSpan.FromSeconds(2), cancellationToken))
            {
                Response.Headers.RetryAfter = "5";
                return StatusCode(StatusCodes.Status429TooManyRequests);
            }

            try
            {
                if (cache.TryGetValue(key, out saved))
                {
                    return Ok(saved);
                }

                var data = await load();
                cache.Set(key, data, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = duration, Size = 1 });
                return Ok(data);
            }
            finally
            {
                AggregateSlots.Release();
            }
        });
}
