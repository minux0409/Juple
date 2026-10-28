using Juple.Application.Expenses;
using Juple.Domain.Expenses;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Expenses;

public sealed class AzureCostReportStore(JupleDbContext db) : IAzureCostReportStore
{
    public async Task<AzureCostReport> ReadAsync(ExpenseAzureScope scope, DateOnly month, DateOnly todayUtc, CancellationToken ct)
    {
        var parts = scope.Scope.Split('/'); var subscription = parts[2]; var group = parts.Length > 4 ? parts[4] : "*";
        var end = month.AddMonths(1); var through = end.AddDays(-1) < todayUtc ? end.AddDays(-1) : todayUtc;
        var previous = month.AddMonths(-1); var previousThrough = previous.AddDays(Math.Min(through.Day, DateTime.DaysInMonth(previous.Year, previous.Month)) - 1);
        var query = db.Expenses.AsNoTracking().Where(x => x.Source == ExpenseSource.Azure && x.SubscriptionId == subscription && x.ResourceGroup == group
            && x.OccurredOn >= previous && x.OccurredOn < end && x.DeletedAtUtc == null && !x.NoLongerReported);
        // Usage snapshots remain visible here even when reconciled to an invoice in the ledger.
        var data = await query.GroupBy(x => new { x.OccurredOn, x.Currency, x.ServiceName })
            .Select(g => new { g.Key.OccurredOn, g.Key.Currency, g.Key.ServiceName, Amount = g.Sum(x => x.GrossAmount) }).ToListAsync(ct);
        var runs = await db.ExpenseSyncRuns.AsNoTracking().Where(x => x.Scope == scope.Scope && (x.Month == month || x.Month == previous)).ToListAsync(ct);
        var currentRun = runs.SingleOrDefault(x => x.Month == month); var previousRun = runs.SingleOrDefault(x => x.Month == previous);
        var totals = data.Select(x => x.Currency).Distinct().Select(currency => {
            decimal? current = currentRun?.LastSuccessAtUtc is null ? null : data.Where(x => x.Currency == currency && x.OccurredOn >= month && x.OccurredOn <= through).Sum(x => x.Amount);
            decimal? prior = previousRun?.LastSuccessAtUtc is null ? null : data.Where(x => x.Currency == currency && x.OccurredOn >= previous && x.OccurredOn <= previousThrough).Sum(x => x.Amount);
            decimal? full = previousRun?.LastSuccessAtUtc is null ? null : data.Where(x => x.Currency == currency && x.OccurredOn < month).Sum(x => x.Amount);
            return new AzureMonthCost(currency, current, prior, full, prior is null or 0 || current is null ? null : (current - prior) / Math.Abs(prior.Value) * 100);
        }).ToArray();
        return new(scope.Scope, month, through, currentRun?.LastSuccessAtUtc, currentRun?.Status ?? "Never", currentRun?.FailureCode, totals,
            data.Where(x => x.OccurredOn >= month && x.OccurredOn <= through).Select(x => new AzureCostPoint(x.OccurredOn, x.ServiceName ?? "Unattributed", x.Currency, x.Amount)).ToArray(),
            new("notRequested", []), new("notRequested", []));
    }

    public async Task<AzureCostHistory> MonthlyAsync(ExpenseAzureScope scope, DateOnly? fromMonth, DateOnly todayUtc, CancellationToken ct)
    {
        var parts = scope.Scope.Split('/'); var subscription = parts[2]; var group = parts.Length > 4 ? parts[4] : "*";
        var current = new DateOnly(todayUtc.Year, todayUtc.Month, 1);
        var rows = db.Expenses.AsNoTracking().Where(x => x.Source == ExpenseSource.Azure && x.SubscriptionId == subscription && x.ResourceGroup == group
            && x.DeletedAtUtc == null && !x.NoLongerReported && x.OccurredOn < current.AddMonths(1));
        if (fromMonth is { } from) rows = rows.Where(x => x.OccurredOn >= from);
        // One grouped query: month x currency sums of the imported daily service snapshots (the same rows the monthly report reads).
        var sums = await rows.GroupBy(x => new { x.OccurredOn.Year, x.OccurredOn.Month, x.Currency })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Currency, Amount = g.Sum(x => x.GrossAmount) }).ToListAsync(ct);
        var runs = await db.ExpenseSyncRuns.AsNoTracking().Where(x => x.Scope == scope.Scope && x.Month <= current && (fromMonth == null || x.Month >= fromMonth))
            .ToListAsync(ct);
        var first = fromMonth ?? runs.Select(x => (DateOnly?)x.Month)
            .Concat(sums.Select(x => (DateOnly?)new DateOnly(x.Year, x.Month, 1))).Min() ?? current;
        var months = new List<AzureMonthlyCost>();
        for (var month = new DateOnly(first.Year, first.Month, 1); month <= current; month = month.AddMonths(1))
        {
            var run = runs.SingleOrDefault(x => x.Month == month);
            var synced = run?.LastSuccessAtUtc is not null;
            months.Add(new AzureMonthlyCost(month, month == current, synced, run?.LastSuccessAtUtc, run?.Status ?? "Never", run?.FailureCode,
                synced ? sums.Where(x => x.Year == month.Year && x.Month == month.Month).OrderBy(x => x.Currency, StringComparer.Ordinal)
                    .Select(x => new AzureCurrencyAmount(x.Currency, x.Amount)).ToArray() : []));
        }
        return new AzureCostHistory(scope.Scope, scope.Environment, todayUtc, months);
    }
}
