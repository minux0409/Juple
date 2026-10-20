namespace Juple.Application.Expenses;

public sealed class ExpenseSyncService(IExpenseStore store, IAzureExpenseSource source, ExpenseService expenses, ExpenseOptions options, TimeProvider time)
{
    public async Task SyncAsync(long? actor, string scope, DateOnly month, CancellationToken ct)
    {
        if (actor is { } admin) await expenses.RequireAdminAsync(admin, ct);
        if (!options.Enabled || !options.AzureSyncEnabled) throw new ExpenseRequestException("azureSyncDisabled", "Azure expense sync is not configured.");
        var configured = options.AzureScopes.SingleOrDefault(item => string.Equals(item.Scope, scope, StringComparison.OrdinalIgnoreCase))
            ?? throw new ExpenseRequestException("invalidExpense", "The scope is not configured for Juple cost collection.");
        ExpenseRules.ValidateScope(configured);
        if (month.Day != 1 || month.Year < 2000 || month > DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime)) ExpenseRules.Fail("Choose the first day of an existing month.");
        var lease = await store.AcquireSyncAsync(configured, month, time.GetUtcNow(), ct);
        if (lease is null) throw new ExpenseRequestException("expenseSyncBusy", "This scope and month are already being synchronized.");
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromMinutes(4));
            var rows = await source.QueryAsync(configured, month, deadline.Token);
            if (rows.Count > 20_000) throw new ExpenseRequestException("expenseSyncTooLarge", "The response exceeds the import limit.");
            foreach (var row in rows)
            {
                if (row.Date.Year != month.Year || row.Date.Month != month.Month || row.ServiceName.Length is < 1 or > 200 || row.RawAmount.Length > 64)
                    throw new ExpenseRequestException("invalidAzureResponse", "Azure returned an invalid cost row.");
                ExpenseRules.Currency(row.Currency);
                if (row.Amount is < -999_999_999_999m or > 999_999_999_999m) ExpenseRules.Fail("Azure amount exceeds supported limits.");
            }
            if (rows.Select(row => ExpenseRules.AzureKey(scope, row)).Distinct().Count() != rows.Count)
                throw new ExpenseRequestException("invalidAzureResponse", "Azure returned duplicate daily service rows.");
            await store.ApplySyncAsync(lease, rows, time.GetUtcNow(), deadline.Token);
        }
        catch (Exception error)
        {
            var code = error is ExpenseRequestException known ? known.Code : error is OperationCanceledException ? "cancelled" : "azureSyncFailed";
            using var cleanupDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { await store.FailSyncAsync(lease, code, cleanupDeadline.Token); } catch { /* lease expiration permits recovery after a database outage */ }
            throw;
        }
    }
    /// <summary>One bounded pass, ready for the existing one-shot Job architecture. No scheduler/resource is deployed here.</summary>
    public async Task RunJobAsync(CancellationToken ct)
    {
        if (!options.Enabled) return;
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        await expenses.MaterializeAsync(null, today.AddDays(30), ct);
        if (!options.AzureSyncEnabled) return;
        var currentMonth = new DateOnly(today.Year, today.Month, 1);
        foreach (var scope in options.AzureScopes)
            foreach (var month in new[] { currentMonth.AddMonths(-1), currentMonth })
                await SyncAsync(null, scope.Scope, month, ct);
    }
}
