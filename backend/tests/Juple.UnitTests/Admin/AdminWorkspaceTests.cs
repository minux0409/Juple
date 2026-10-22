using System.Net;
using System.Text.Json;
using Azure.Core;
using Juple.Api.Controllers.Admin;
using Juple.Application.Admin;
using Juple.Application.Billing;
using Juple.Application.Expenses;
using Juple.Domain.Expenses;
using Juple.Infrastructure.Analytics;
using Juple.Infrastructure.Expenses;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Juple.UnitTests.Admin;

public sealed class AdminWorkspaceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 15, 0, 0, TimeSpan.Zero);
    [Fact] public void Seoul_midnight_and_default_seven_days_have_exact_UTC_boundaries()
    {
        var p = AdminDateRange.Resolve(null, null, null, Now);
        Assert.Equal(new DateOnly(2026, 10, 15), p.From); Assert.Equal(new DateOnly(2026, 10, 21), p.Through);
        Assert.Equal(7, p.Days); Assert.Equal(new DateTimeOffset(2026, 10, 14, 15, 0, 0, TimeSpan.Zero), p.StartUtc);
        Assert.Equal(Now.AddDays(1), p.EndExclusiveUtc);
        Assert.Equal(new DateOnly(2026, 10, 20), AdminDateRange.SeoulDate(Now.AddTicks(-1)));
    }
    [Fact] public void Period_validation_handles_leap_year_future_reversed_and_maximum_range()
    {
        Assert.Equal(366, AdminDateRange.Resolve(null, new(2024, 1, 1), new(2024, 12, 31), Now).Days);
        foreach (var p in new (DateOnly?, DateOnly?)[] { (new(2024,1,1),new(2025,1,1)), (new(2026,10,22),new(2026,10,22)),
            (new(2026,10,20),new(2026,10,19)), (new(1999,12,31),new(2000,1,1)), (new(2026,1,1),null) })
            Assert.Throws<InvalidAdminRequestException>(() => AdminDateRange.Resolve(null, p.Item1, p.Item2, Now));
        Assert.Throws<InvalidAdminRequestException>(() => AdminDateRange.Resolve("1year", null, null, Now));
        Assert.False(new AdminWorkspaceOptions().Enabled); Assert.False(new AdminWorkspaceOptions().TelemetryEnabled);
        Assert.False(new ExpenseOptions().AzureInsightsEnabled);
    }
    private static AdminWorkspaceController Controller(IAdminWorkspaceStore? store, MemoryCache cache, bool enabled = true)
        => new(store!, new() { Enabled = enabled }, new BillingOptions(), new Clock(), cache, null!) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
    [Fact] public async Task Feature_off_never_touches_new_schema_and_returns_no_store()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions()); var c = Controller(null, cache, false);
        Assert.IsType<NotFoundObjectResult>(await c.Overview(null, null, null, default));
        Assert.Equal("private, no-store", c.Response.Headers.CacheControl);
    }
    [Fact] public async Task Aggregate_limit_rejects_parallel_work_and_releases_after_failure()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions()); var store = new WaitingStore();
        var first = Controller(store, cache).Overview(null, null, null, default);
        await store.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var second = Controller(store, cache);
        Assert.Equal(429, Assert.IsType<StatusCodeResult>(await second.Overview(null, null, null, default)).StatusCode);
        Assert.Equal("5", second.Response.Headers.RetryAfter);
        store.Done.SetException(new OperationCanceledException());
        await Assert.ThrowsAsync<OperationCanceledException>(() => first);
        var next = Controller(new RevenueStore(), cache);
        Assert.IsType<OkObjectResult>(await next.Revenue(default));
    }
    [Fact] public void Expense_classification_period_and_rate_source_round_trip_into_exports()
    {
        var v = ExpenseRules.Validate(new ExpenseValues("Annual domain", "Registrar", ExpenseCategory.Other, new(2026,10,20), new(2026,10,20), "USD", null, null, 20m,
            "card", ExpenseStatus.Paid, ExpenseKind.Charge, null, null, "KRW", 1400m, new(2026,10,20),
            CustomCategory: "Brand protection", PeriodFrom: new(2026,10,20), PeriodThrough: new(2027,10,19), ExchangeRateSource: "Issuer statement", ServiceName: "DNS"));
        var e = new Expense(Guid.NewGuid(), ExpenseSource.Manual, "fixture", v, 1, Now);
        Assert.Equal(v, e.Values());
        var csv = System.Text.Encoding.UTF8.GetString(ExpenseSpreadsheetWriter.Csv([new(e, [])]));
        Assert.Contains("ExchangeRateSource", csv); Assert.Contains("Issuer statement", csv); Assert.Contains("2027-10-19", csv);
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(v with { Category = ExpenseCategory.Cloud }));
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(v with { PeriodThrough = null }));
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(v with { PeriodThrough = new(2025,1,1) }));
        const string subscription = "/subscriptions/00000000-0000-0000-0000-000000000001";
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.ValidateScope(new(subscription, "DEV")));
        ExpenseRules.ValidateScope(new(subscription, "DEV", true));
    }
    [Fact] public async Task Azure_resources_and_forecast_use_readonly_ARM_fixed_dimensions_and_named_columns()
    {
        var calls = 0;
        using var http = new HttpClient(new Handler(async request => {
            calls++; var body = await request.Content!.ReadAsStringAsync();
            Assert.Equal(HttpMethod.Post, request.Method); Assert.Equal("management.azure.com", request.RequestUri!.Host);
            Assert.Contains("ActualCost", body);
            if (request.RequestUri.AbsolutePath.EndsWith("forecast")) {
                Assert.Contains("\"includeActualCost\":true", body);
                return Json("""{"properties":{"columns":[{"name":"Currency"},{"name":"UsageDate"},{"name":"Cost"}],"rows":[["KRW",20261020,45.5]]}}""");
            }
            Assert.Contains("ResourceId", body);
            return Json("""{"properties":{"columns":[{"name":"ResourceId"},{"name":"Currency"},{"name":"UsageDate"},{"name":"PreTaxCost"}],"rows":[["/subscriptions/fixture/resourceGroups/test/providers/Microsoft.Sql/servers/test","KRW",20261020,12.5]]}}""");
        }));
        var source = new AzureExpenseSource(http, new Credential());
        var scope = new ExpenseAzureScope("/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test", "DEV");
        Assert.Equal(12.5m, Assert.Single((await source.ResourcesAsync(scope, new(2026,10,1), default)).Points).Amount);
        Assert.Equal(45.5m, Assert.Single((await source.ForecastAsync(scope, new(2026,10,1), default)).Points).Amount);
        Assert.Equal(2, calls);
        using var denied = new HttpClient(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden))));
        var unavailable = await new AzureExpenseSource(denied, new Credential()).ForecastAsync(scope, new(2026,10,1), default);
        Assert.Equal("azureCostAccessDenied", unavailable.Status); Assert.Empty(unavailable.Points);
    }
    [Fact] public async Task Azure_telemetry_is_opt_in_aggregate_only_and_denied_is_not_zero()
    {
        using var http = new HttpClient(new Handler(async request => {
            var body = await request.Content!.ReadAsStringAsync();
            Assert.Contains("summarize", body); Assert.Contains("Asia/Seoul", body); Assert.DoesNotContain("ClientIP", body);
            return Json("""{"tables":[{"columns":[{"name":"Requests"},{"name":"Day"},{"name":"Unauthorized"},{"name":"Errors5xx"}],"rows":[[8,"2026-10-20T00:00:00Z",1,2]]}]}""");
        }));
        var range = new AdminDateRange(new(2026,10,20),new(2026,10,20));
        Assert.False((await new AzureAdminTelemetrySource(http,new Credential(),new()).ReadAsync(range,default)).Available);
        var settings = new AdminWorkspaceOptions { TelemetryEnabled = true, TelemetryWorkspaceId = Guid.NewGuid().ToString(), TelemetryRoleName = "fixture-api" };
        var metrics = await new AzureAdminTelemetrySource(http,new Credential(),settings).ReadAsync(range,default);
        Assert.True(metrics.Available); Assert.Equal(2, Assert.Single(metrics.Days).Errors5xx);
        using var denied = new HttpClient(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden))));
        metrics = await new AzureAdminTelemetrySource(denied,new Credential(),settings).ReadAsync(range,default);
        Assert.False(metrics.Available); Assert.Equal("accessDenied",metrics.Status); Assert.Empty(metrics.Days);
    }
    private static HttpResponseMessage Json(string text) => new(HttpStatusCode.OK) { Content = new StringContent(text) };
    private sealed class Handler(Func<HttpRequestMessage,Task<HttpResponseMessage>> respond) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken) => respond(request); }
    private sealed class Credential : TokenCredential
    { public override AccessToken GetToken(TokenRequestContext requestContext,CancellationToken cancellationToken) => new("fixture-only",Now.AddYears(1)); public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext,CancellationToken cancellationToken) => ValueTask.FromResult(GetToken(requestContext,cancellationToken)); }
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private class RevenueStore : IAdminWorkspaceStore
    {
        public virtual Task<WorkspaceOverview> OverviewAsync(AdminDateRange period,DateTimeOffset now,CancellationToken ct) => throw new NotImplementedException();
        public Task<WorkspaceOperations> OperationsAsync(AdminDateRange period,CancellationToken ct) => throw new NotImplementedException();
        public Task<WorkspaceRevenue> RevenueAsync(bool billingEnabled,CancellationToken ct) => Task.FromResult(new WorkspaceRevenue(billingEnabled,[],false,"No transaction ledger"));
    }
    private sealed class WaitingStore : RevenueStore
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<WorkspaceOverview> Done { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override Task<WorkspaceOverview> OverviewAsync(AdminDateRange period,DateTimeOffset now,CancellationToken ct) { Started.SetResult();return Done.Task; }
    }
}
