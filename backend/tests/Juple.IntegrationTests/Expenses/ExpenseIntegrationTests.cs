using Azure.Storage.Blobs;
using Juple.Application.Admin;
using Juple.Application.Expenses;
using Juple.Domain.Admin;
using Juple.Domain.Expenses;
using Juple.Infrastructure.Expenses;
using Juple.Infrastructure.Persistence;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Expenses;

// Every write is confined to the explicitly guarded localhost/JupleRetTests fixture.
public sealed class ExpenseIntegrationTests : IAsyncLifetime
{
    private readonly string _marker = "expense-test-" + Guid.NewGuid().ToString("N");
    private string _connection = null!;
    private static readonly DateOnly Day = new(2026, 10, 20);
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly List<long> _ids = [];
    private readonly List<string> _blobs = [];
    private string Scope => "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/" + _marker;
    private ExpenseValues Values(string currency = "KRW") => new(_marker, _marker, ExpenseCategory.Software, Day, Day, currency, 100m, 10m, 110m, "test card", ExpenseStatus.Paid, ExpenseKind.Charge, null, "Integration fixture");
    private JupleDbContext Db() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connection).Options);
    private static ExpenseStore Store(JupleDbContext db) => new(db, TimeProvider.System);
    public Task InitializeAsync() { _connection = LocalRetentionEnvironment.RequireConnectionString(); return Task.CompletedTask; }
    public async Task DisposeAsync()
    {
        await using var db = Db();
        var ids = await db.Expenses.Where(e => e.Name == _marker || e.ResourceGroup == _marker).Select(e => e.Id).ToListAsync();
        ids.AddRange(_ids); ids = ids.Distinct().ToList();
        await db.ExpenseAttachments.Where(a => ids.Contains(a.ExpenseId)).ExecuteDeleteAsync();
        await db.ExpenseRecurringSchedules.Where(a => ids.Contains(a.TemplateExpenseId)).ExecuteDeleteAsync();
        await db.ExpenseAuditLogs.Where(a => a.ExpenseId != null && ids.Contains(a.ExpenseId.Value)).ExecuteDeleteAsync();
        await db.Expenses.Where(e => ids.Contains(e.Id)).ExecuteUpdateAsync(s => s.SetProperty(e => e.OriginalExpenseId, (long?)null).SetProperty(e => e.ReconciledByExpenseId, (long?)null));
        await db.Expenses.Where(e => ids.Contains(e.Id)).ExecuteDeleteAsync();
        await db.ExpenseSyncRuns.Where(r => r.Scope == Scope).ExecuteDeleteAsync();
        var container = new BlobServiceClient("UseDevelopmentStorage=true").GetBlobContainerClient("expense-evidence");
        foreach (var blob in _blobs) await container.DeleteBlobIfExistsAsync(blob);
    }
    private async Task<ExpenseRow> Save(ExpenseValues? values = null, ExpenseFrequency? frequency = null, DateOnly? due = null)
    {
        await using var db = Db();
        var row = await Store(db).SaveAsync(9001, null, new(Guid.NewGuid(), values ?? Values(), Frequency: frequency, NextDueOn: due), Ct);
        _ids.Add(row.Expense.Id); return row;
    }
    [Fact] public async Task Idempotent_create_invoice_dedup_and_optimistic_edit_are_enforced()
    {
        var request = new ExpenseWrite(Guid.NewGuid(), Values() with { InvoiceReference = _marker });
        await using var db = Db(); var store = Store(db);
        var first = await store.SaveAsync(9001, null, request, Ct); _ids.Add(first.Expense.Id);
        Assert.Equal(first.Expense.Id, (await store.SaveAsync(9001, null, request, Ct)).Expense.Id);
        await using var duplicateDb = Db();
        await Assert.ThrowsAsync<ExpenseRequestException>(() => Store(duplicateDb).SaveAsync(9001, null, request with { RequestId = Guid.NewGuid() }, Ct));
        var revision = first.Expense.Revision;
        await store.SaveAsync(9001, first.Expense.Id, request with { ExpectedRevision = revision, Values = request.Values with { Memo = "edit" } }, Ct);
        await using var staleDb = Db();
        await Assert.ThrowsAsync<ExpenseRequestException>(() => Store(staleDb).SaveAsync(9001, first.Expense.Id, request with { ExpectedRevision = revision }, Ct));
        Assert.Equal(2, (await store.AuditAsync(first.Expense.Id, null, Ct)).Count);
    }
    [Fact] public async Task Summary_filters_currencies_tax_and_status_without_double_counting()
    {
        await Save(); await Save(Values("USD") with { Status = ExpenseStatus.Estimated, PaidOn = null, NetAmount = null, TaxAmount = null });
        await Save(Values() with { Status = ExpenseStatus.Cancelled });
        await using var db = Db(); var store = Store(db); var filter = new ExpenseFilter(Day, Day, Provider: _marker);
        var summary = await store.SummaryAsync(filter, Ct); Assert.Equal(2, summary.Totals.Count);
        var paid = Assert.Single(summary.Totals, t => t.Currency == "KRW"); Assert.Equal(110m, paid.Gross); Assert.Equal(10m, paid.Tax); Assert.Equal(1, paid.MissingEvidence);
        var estimated = Assert.Single(summary.Totals, t => t.Currency == "USD"); Assert.Null(estimated.Tax); Assert.Equal(1, estimated.UnknownTax);
        var page = await store.ListAsync(filter with { Currency = "USD" }, Ct); Assert.Single(page.Items);
        Assert.Single(summary.Months, t => t.Currency == "KRW");
    }
    [Fact] public async Task Refunds_cannot_exceed_original_or_be_cross_currency_and_original_is_protected()
    {
        var original = (await Save()).Expense;
        var refund = Values() with { Kind = ExpenseKind.Refund, OriginalExpenseId = original.Id, NetAmount = -50, TaxAmount = -5, GrossAmount = -55 };
        await Save(refund);
        await using var db = Db(); var store = Store(db);
        await Assert.ThrowsAsync<ExpenseRequestException>(() => store.SaveAsync(9001, null, new(Guid.NewGuid(), refund with { Currency = "USD" }), Ct));
        await using var excessDb = Db();
        await Assert.ThrowsAsync<ExpenseRequestException>(() => Store(excessDb).SaveAsync(9001, null, new(Guid.NewGuid(), refund with { NetAmount = -60, TaxAmount = -6, GrossAmount = -66 }), Ct));
        await using var deleteDb = Db(); await Assert.ThrowsAsync<ExpenseRequestException>(() => Store(deleteDb).DeleteAsync(9001, original.Id, original.Revision, Ct));
    }
    [Fact] public async Task Recurring_generation_is_idempotent_estimated_and_preserves_month_end()
    {
        var root = await Save(Values() with { OccurredOn = new(2026, 1, 1) }, ExpenseFrequency.Monthly, new(2026, 1, 31));
        await using var db = Db(); var store = Store(db);
        await store.MaterializeAsync(9001, new(2026, 3, 31), Ct);
        Assert.Equal(0, await store.MaterializeAsync(9001, new(2026, 3, 31), Ct));
        var generated = await db.Expenses.AsNoTracking().Where(e => e.Name == _marker && e.Source == ExpenseSource.Recurring).OrderBy(e => e.OccurredOn).ToListAsync();
        Assert.Equal(new[] { new DateOnly(2026, 1, 31), new(2026, 2, 28), new(2026, 3, 31) }, generated.Select(e => e.OccurredOn));
        Assert.All(generated, e => { Assert.Equal(ExpenseStatus.Estimated, e.Status); Assert.Null(e.PaidOn); });
        var reminders = await store.DueAsync(new(2026, 3, 31), Ct);
        Assert.Equal(3, reminders.Count(e => e.Expense.Name == _marker));
        var schedule = await db.ExpenseRecurringSchedules.SingleAsync(s => s.TemplateExpenseId == root.Expense.Id);
        Assert.Equal(new DateOnly(2026, 4, 30), schedule.NextDueOn); // forecasts still appear in reminders after this advances
        await store.DisableScheduleAsync(9001, schedule.Id, schedule.Revision, Ct);
        Assert.Equal(0, await store.MaterializeAsync(9001, new(2026, 4, 30), Ct));
    }
    [Fact] public async Task Conversion_round_trips_sql_precision_and_keeps_summary_in_original_currency()
    {
        var values = ExpenseRules.Validate(Values("USD") with { ConvertedCurrency = "KRW", ExchangeRate = 1375.123456789012m, ExchangeRateOn = Day });
        var saved = await Save(values);
        await using var db = Db(); var store = Store(db);
        var row = await store.GetAsync(saved.Expense.Id, Ct);
        Assert.Equal(values, row.Expense.Values());
        var summary = await store.SummaryAsync(new(Day, Day, Provider: _marker), Ct);
        var total = Assert.Single(summary.Totals); Assert.Equal("USD", total.Currency); Assert.Equal(110m, total.Gross);
        Assert.DoesNotContain(summary.Totals, item => item.Currency == "KRW");
        var exported = await store.ExportAsync(new(Day, Day, Provider: _marker), Ct);
        Assert.Equal(1375.123456789012m, Assert.Single(exported).Expense.ExchangeRate);
    }
    [Fact] public async Task Concurrent_sync_has_one_lease_and_reimports_correct_without_duplicates()
    {
        async Task<ExpenseLease?> Acquire() { await using var db = Db(); return await Store(db).AcquireSyncAsync(new(Scope, "DEV"), new(2026, 10, 1), DateTimeOffset.UtcNow, Ct); }
        var leases = await Task.WhenAll(Acquire(), Acquire()); var lease = Assert.Single(leases, l => l is not null)!;
        await using var db = Db(); var store = Store(db);
        var cost = new AzureExpenseCost(Day, "SQL Database", "KRW", 123.1234561234567m, "123.1234561234567");
        await store.ApplySyncAsync(lease, [cost], DateTimeOffset.UtcNow, Ct);
        var imported = await db.Expenses.SingleAsync(e => e.ResourceGroup == _marker); _ids.Add(imported.Id);
        Assert.Equal(123.123456123457m, imported.GrossAmount); Assert.Equal(cost.RawAmount, imported.RawImportedAmount); Assert.Null(imported.TaxAmount);
        Assert.DoesNotContain(await store.DueAsync(Day, Ct), row => row.Expense.Id == imported.Id);
        var second = (await Acquire())!; await store.ApplySyncAsync(second, [cost with { Amount = 10m, RawAmount = "10" }], DateTimeOffset.UtcNow, Ct);
        Assert.Single(await db.Expenses.Where(e => e.ResourceGroup == _marker).ToListAsync()); Assert.Equal(10m, imported.GrossAmount);
        var third = (await Acquire())!; await store.ApplySyncAsync(third, [], DateTimeOffset.UtcNow, Ct);
        Assert.True(imported.NoLongerReported);
    }
    [Fact] public async Task Invoice_reconciliation_excludes_estimates_from_totals_and_unlinks_on_delete()
    {
        await using var db = Db(); var store = Store(db);
        var lease = (await store.AcquireSyncAsync(new(Scope, "DEV"), new(2026, 10, 1), DateTimeOffset.UtcNow, Ct))!;
        await store.ApplySyncAsync(lease, [new(Day, "SQL Database", "KRW", 100m, "100")], DateTimeOffset.UtcNow, Ct);
        var imported = await db.Expenses.SingleAsync(e => e.ResourceGroup == _marker); _ids.Add(imported.Id);
        var invoice = await store.SaveAsync(9001, null, new(Guid.NewGuid(), Values() with { Provider = "Microsoft Azure", InvoiceReference = _marker }, ReconcilesExpenseIds: [imported.Id]), Ct); _ids.Add(invoice.Expense.Id);
        var summary = await store.SummaryAsync(new(Day, Day, Provider: "Microsoft Azure", Environment: null), Ct);
        Assert.Equal(110m, Assert.Single(summary.Totals).Gross);
        Assert.Equal(ExpenseStatus.Paid, Assert.Single(summary.Totals).Status);
        Assert.Equal(invoice.Expense.Id, imported.ReconciledByExpenseId);
        Assert.DoesNotContain((await store.ListAsync(new(Day, Day, Environment: "DEV", ServiceName: "SQL Database"), Ct)).Items.Where(r => r.Expense.Id == imported.Id), r => r.Expense.ReconciledByExpenseId is null);
        await store.DeleteAsync(9001, invoice.Expense.Id, invoice.Expense.Revision, Ct);
        Assert.Null(imported.ReconciledByExpenseId);
        Assert.Equal(100m, Assert.Single((await store.SummaryAsync(new(Day, Day, Provider: "Microsoft Azure"), Ct)).Totals).Gross);
    }
    [Fact] public async Task Private_evidence_download_is_bound_to_expense_and_deleted_expenses_revoke_access()
    {
        var first = (await Save()).Expense; var other = (await Save()).Expense;
        await using var db = Db(); var store = Store(db);
        var access = new Lookup(); var service = new ExpenseService(store, access, new ExpenseOptions { Enabled = true }, TimeProvider.System);
        var files = new ExpenseEvidenceFiles(new BlobServiceClient("UseDevelopmentStorage=true"));
        var evidence = new ExpenseEvidenceService(service, store, new CleanScanner(), files, TimeProvider.System);
        var info = await evidence.UploadAsync(9001, first.Id, Guid.NewGuid(), "invoice.pdf", new MemoryStream("%PDF-1.7 local test"u8.ToArray()), Ct);
        var persisted = await db.ExpenseAttachments.AsNoTracking().SingleAsync(a => a.Id == info.Id); _blobs.Add(persisted.BlobName);
        Assert.Equal("None", (await new BlobServiceClient("UseDevelopmentStorage=true").GetBlobContainerClient("expense-evidence").GetPropertiesAsync()).Value.PublicAccess.ToString());
        await Assert.ThrowsAsync<ExpenseNotFoundException>(() => evidence.DownloadAsync(9001, other.Id, info.Id, Ct));
        var downloaded = await evidence.DownloadAsync(9001, first.Id, info.Id, Ct); using (downloaded.Content) { using var reader = new StreamReader(downloaded.Content); Assert.Equal("%PDF-1.7 local test", await reader.ReadToEndAsync()); }
        access.Active = false; await Assert.ThrowsAsync<ExpenseForbiddenException>(() => evidence.DownloadAsync(9001, first.Id, info.Id, Ct)); access.Active = true;
        await store.DeleteAsync(9001, first.Id, first.Revision, Ct);
        await Assert.ThrowsAsync<ExpenseNotFoundException>(() => evidence.DownloadAsync(9001, first.Id, info.Id, Ct));
    }
    private sealed class Lookup : IAdminAccessStore { public bool Active = true; public Task<AdminAccess?> FindActiveAsync(long userId, CancellationToken cancellationToken = default) => Task.FromResult<AdminAccess?>(Active ? new(userId, AdminRole.Owner) : null); }
    // Explicit fixture, not the production scanner. Real scanner is separately fail-closed tested.
    private sealed class CleanScanner : IExpenseEvidenceScanner { public Task ScanAsync(ReadOnlyMemory<byte> bytes, CancellationToken ct) => Task.CompletedTask; }
}
