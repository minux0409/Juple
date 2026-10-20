using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Api.Configuration;
using Juple.Application.Billing;
using Juple.Application.Expenses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers.Admin;

[ApiController]
[Route("api/v1/admin/expenses")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminExpensesController(ExpenseService service, ExpenseSyncService sync, ExpenseEvidenceService evidence, ExpenseOptions options) : ControllerBase
{
    private static readonly SemaphoreSlim HeavyRequests = new(2);
    private long Actor => AdminRequestContext.GetRequired(HttpContext).UserId;
    private async Task<IActionResult> Run(Func<Task<IActionResult>> action, bool heavy = false)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (heavy && !await HeavyRequests.WaitAsync(0, HttpContext.RequestAborted))
            return StatusCode(429, new { code = "expenseBusy" });
        try { return await action(); }
        catch (ExpenseForbiddenException) { return Forbid(); }
        catch (ExpenseNotFoundException) { return NotFound(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { code = "expenseConflict" }); }
        catch (ExpenseRequestException e)
        {
            var status = e.Code == "expensesDisabled" ? 404 : e.Code.Contains("Conflict", StringComparison.OrdinalIgnoreCase) || e.Code.Contains("Duplicate", StringComparison.OrdinalIgnoreCase) || e.Code == "expenseSyncBusy" ? 409
                : e.Code == "evidenceTooLarge" ? 413 : e.Code is "evidenceScannerUnavailable" or "azureCostUnavailable" ? 503 : 400;
            return StatusCode(status, new { code = e.Code, errors = new { expense = new[] { e.Message } } });
        }
        finally { if (heavy) HeavyRequests.Release(); }
    }
    [HttpGet("configuration")]
    public Task<IActionResult> Configuration(CancellationToken ct) => Run(async () => {
        // The existing policy has already checked the active grant. No SQL ledger access while the feature is disabled.
        await Task.CompletedTask;
        return Ok(new { options.Enabled, options.AzureSyncEnabled, options.AzureScopes, EvidenceScanningConfigured = !string.IsNullOrWhiteSpace(options.ClamAvHost),
            Pricing = new { MonthlyUsdReferencePrice = SubscriptionPricingPolicy.MonthlyUsdReferencePrice, Currency = SubscriptionPricingPolicy.ReferenceCurrency,
                Period = SubscriptionPricingPolicy.BillingPeriod, TrialDays = SubscriptionPricingPolicy.TrialDays, CheckoutPriceSource = "storeMetadata" } });
    });
    [HttpGet]
    public Task<IActionResult> List([FromQuery] ExpenseFilter filter, CancellationToken ct) => Run(async () => Ok(await service.ListAsync(Actor, filter, ct)));
    [HttpGet("{id:long}")]
    public Task<IActionResult> Get(long id, CancellationToken ct) => Run(async () => Ok(await service.GetAsync(Actor, id, ct)));
    [HttpGet("summary")]
    public Task<IActionResult> Summary([FromQuery] ExpenseFilter filter, CancellationToken ct) => Run(async () => Ok(await service.SummaryAsync(Actor, filter, ct)));
    [HttpGet("due")]
    public Task<IActionResult> Due([FromQuery] DateOnly asOf, CancellationToken ct) => Run(async () => Ok(await service.DueAsync(Actor, asOf, ct)));
    [HttpPost]
    public Task<IActionResult> Create([FromBody] ExpenseWrite request, CancellationToken ct) => Run(async () => Ok(await service.SaveAsync(Actor, null, request, ct)));
    [HttpPut("{id:long}")]
    public Task<IActionResult> Edit(long id, [FromBody] ExpenseWrite request, CancellationToken ct) => Run(async () => Ok(await service.SaveAsync(Actor, id, request, ct)));
    [HttpDelete("{id:long}")]
    public Task<IActionResult> Delete(long id, [FromQuery] long revision, CancellationToken ct) => Run(async () => { await service.DeleteAsync(Actor, id, revision, ct); return NoContent(); });
    [HttpGet("{id:long}/audit")]
    public Task<IActionResult> Audit(long id, [FromQuery] long? cursor, CancellationToken ct) => Run(async () => Ok(await service.AuditAsync(Actor, id, cursor, ct)));
    [HttpGet("schedules")]
    public Task<IActionResult> Schedules(CancellationToken ct) => Run(async () => Ok(await service.SchedulesAsync(Actor, ct)));
    [HttpDelete("schedules/{id:long}")]
    public Task<IActionResult> DisableSchedule(long id, [FromQuery] long revision, CancellationToken ct) => Run(async () => { await service.DisableScheduleAsync(Actor, id, revision, ct); return NoContent(); });
    public sealed record ProjectRequest(DateOnly Through);
    [HttpPost("schedules/project")]
    public Task<IActionResult> Project(ProjectRequest request, CancellationToken ct) => Run(async () => Ok(new { count = await service.MaterializeAsync(Actor, request.Through, ct) }), true);
    public sealed record SyncRequest(string Scope, DateOnly Month);
    [HttpPost("sync")]
    public Task<IActionResult> Sync(SyncRequest request, CancellationToken ct) => Run(async () => { await sync.SyncAsync(Actor, request.Scope, request.Month, ct); return NoContent(); }, true);
    [HttpGet("sync")]
    public Task<IActionResult> SyncRuns(CancellationToken ct) => Run(async () => Ok(await service.SyncRunsAsync(Actor, ct)));
    [HttpGet("export")]
    [EnableRateLimiting(RateLimitPolicies.ExpenseFiles)]
    public Task<IActionResult> Export([FromQuery] ExpenseFilter filter, [FromQuery] string format, CancellationToken ct) => Run(async () => {
        if (format is not ("csv" or "xlsx")) ExpenseRules.Fail("Choose CSV or XLSX.");
        var rows = await service.ExportAsync(Actor, filter, ct);
        return File(format == "csv" ? ExpenseSpreadsheetWriter.Csv(rows) : ExpenseSpreadsheetWriter.Excel(rows),
            format == "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"juple-expenses-{filter.From:yyyyMMdd}-{filter.Through:yyyyMMdd}.{format}");
    }, true);
    [HttpPost("{id:long}/attachments")]
    [EnableRateLimiting(RateLimitPolicies.ExpenseFiles)]
    [RequestSizeLimit(ExpenseOptions.MaxAttachmentBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = ExpenseOptions.MaxAttachmentBytes + 64 * 1024)]
    public Task<IActionResult> Upload(long id, [FromForm] Guid requestId, [FromForm] IFormFile file, CancellationToken ct) => Run(async () => {
        if (file.Length > ExpenseOptions.MaxAttachmentBytes) throw new ExpenseRequestException("evidenceTooLarge", "Evidence is limited to 10 MiB.");
        await using var input = file.OpenReadStream();
        return Ok(await evidence.UploadAsync(Actor, id, requestId, file.FileName, input, ct));
    }, true);
    [HttpGet("{id:long}/attachments/{attachmentId:long}")]
    [EnableRateLimiting(RateLimitPolicies.ExpenseFiles)]
    public Task<IActionResult> Download(long id, long attachmentId, CancellationToken ct) => Run(async () => {
        var result = await evidence.DownloadAsync(Actor, id, attachmentId, ct);
        // MVC disposes the stream after sending or aborting. Download only: do not render PDFs/HTML in the Admin origin.
        return File(result.Content, result.Info.ContentType, result.Info.FileName, enableRangeProcessing: false);
    });
    [HttpDelete("{id:long}/attachments/{attachmentId:long}")]
    public Task<IActionResult> DeleteAttachment(long id, long attachmentId, CancellationToken ct) => Run(async () => { await evidence.DeleteAsync(Actor, id, attachmentId, ct); return NoContent(); });
}
