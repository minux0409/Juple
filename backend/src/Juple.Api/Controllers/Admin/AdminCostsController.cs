using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Expenses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// 비용 및 수익 > 월별 서버 비용: the imported Azure usage cost per billing month for one CONFIGURED project scope (never an
/// arbitrary subscription). The same ledger rows and admin re-check as the existing monthly Azure report; this endpoint reads
/// SQL only and never calls Azure.
/// </summary>
[ApiController]
[Route("api/v1/admin/costs")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminCostsController(ExpenseService expenses, ExpenseOptions options, IAzureCostReportStore store, TimeProvider time) : ControllerBase
{
    /// <summary>months = 6 | 12 | all (default 6), including the current month; scope = one of the configured scopes (default: the first).</summary>
    [HttpGet("history")]
    public async Task<IActionResult> HistoryAsync([FromQuery] string? months, [FromQuery] string? scope, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try
        {
            await expenses.RequireAdminAsync(AdminRequestContext.GetRequired(HttpContext).UserId, ct);
            var configured = scope is null
                ? options.AzureScopes.FirstOrDefault()
                : options.AzureScopes.SingleOrDefault(x => x.Scope.Equals(scope, StringComparison.OrdinalIgnoreCase));
            if (configured is null)
            {
                return NotFound(new { code = "azureScopeNotConfigured" });
            }

            ExpenseRules.ValidateScope(configured);
            var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
            var current = new DateOnly(today.Year, today.Month, 1);
            DateOnly? from = (months ?? "6") switch
            {
                "6" => current.AddMonths(-5),
                "12" => current.AddMonths(-11),
                "all" => null,
                _ => throw new ExpenseRequestException("invalidMonths", "Choose 6, 12 or all."),
            };
            return Ok(await store.MonthlyAsync(configured, from, today, ct));
        }
        catch (ExpenseForbiddenException) { return Forbid(); }
        catch (ExpenseRequestException e) { return StatusCode(e.Code == "expensesDisabled" ? 404 : 400, new { code = e.Code, errors = new { expense = new[] { e.Message } } }); }
    }
}
