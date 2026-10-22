using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Expenses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Juple.Api.Controllers.Admin;

[ApiController]
[Route("api/v1/admin/expenses/azure-report")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminAzureCostsController(ExpenseService expenses, ExpenseOptions options, IAzureCostReportStore store,
    IAzureCostDetailsSource source, IMemoryCache cache, TimeProvider time) : ControllerBase
{
    private static readonly SemaphoreSlim Slots = new(1);
    public sealed record ReportRequest(string Scope, DateOnly Month, bool IncludeDetails = false);
    [HttpPost]
    public async Task<IActionResult> Read(ReportRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try {
            await expenses.RequireAdminAsync(AdminRequestContext.GetRequired(HttpContext).UserId, ct);
            var configured = options.AzureScopes.SingleOrDefault(x => x.Scope.Equals(request.Scope, StringComparison.OrdinalIgnoreCase));
            if (configured is null) ExpenseRules.Fail("Choose a configured Juple project scope.");
            ExpenseRules.ValidateScope(configured!);
            var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
            if (request.Month.Day != 1 || request.Month.Year < 2000 || request.Month > today) ExpenseRules.Fail("Choose the first day of an existing billing month.");
            var report = await store.ReadAsync(configured!, request.Month, today, ct);
            if (!request.IncludeDetails) return Ok(report);
            if (!options.AzureInsightsEnabled) return Ok(report with { Resources = new("notConfigured", []), Forecast = new("notConfigured", []) });
            var key = $"azure-details:{configured!.Scope.ToLowerInvariant()}:{request.Month:yyyyMM}";
            if (cache.TryGetValue<(AzureCostDetail Resources, AzureCostDetail Forecast)>(key, out var saved))
                return Ok(report with { Resources = saved.Resources, Forecast = saved.Forecast });
            if (!await Slots.WaitAsync(0, ct)) { Response.Headers.RetryAfter = "10"; return StatusCode(429); }
            try {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromMinutes(3));
                var resources = await source.ResourcesAsync(configured, request.Month, deadline.Token);
                var currentMonth = new DateOnly(today.Year, today.Month, 1);
                var forecast = request.Month == currentMonth ? await source.ForecastAsync(configured, request.Month, deadline.Token) : new AzureCostDetail("historicalMonth", []);
                cache.Set(key, (resources, forecast), new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10), Size = 1 });
                return Ok(report with { Resources = resources, Forecast = forecast });
            }
            finally { Slots.Release(); }
        }
        catch (ExpenseForbiddenException) { return Forbid(); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return StatusCode(503,new { code = "azureCostTimeout" }); }
        catch (ExpenseRequestException e) { return StatusCode(e.Code == "expensesDisabled" ? 404 : 400, new { code = e.Code, errors = new { expense = new[] { e.Message } } }); }
    }
}
