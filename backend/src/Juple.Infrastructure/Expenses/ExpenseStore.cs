using System.Globalization;
using System.Text.Json;
using Juple.Application.Expenses;
using Juple.Domain.Expenses;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Expenses;

public sealed class ExpenseStore(JupleDbContext db, TimeProvider time) : IExpenseStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string Snapshot(Expense e) => JsonSerializer.Serialize(new { values = e.Values(), e.Source, e.ReconciledByExpenseId, e.NoLongerReported, e.RawImportedAmount, e.DeletedAtUtc, e.Revision }, Json);
    private void Audit(long? actor, string action, long? id, string? before, string? after) =>
        db.ExpenseAuditLogs.Add(new ExpenseAuditLog(actor, action, id, before, after, time.GetUtcNow()));
    private IQueryable<Expense> Query(ExpenseFilter f)
    {
        var q = db.Expenses.AsNoTracking().Where(e => e.DeletedAtUtc == null && e.OccurredOn >= f.From && e.OccurredOn <= f.Through);
        if (f.Category is { } category) q = q.Where(e => e.Category == category);
        if (f.Status is { } status) q = q.Where(e => e.Status == status);
        if (f.Currency is { } currency) q = q.Where(e => e.Currency == currency);
        if (!string.IsNullOrWhiteSpace(f.Provider)) q = q.Where(e => e.Provider == f.Provider);
        if (!string.IsNullOrWhiteSpace(f.PaymentMethod)) q = q.Where(e => e.PaymentMethod == f.PaymentMethod);
        if (!string.IsNullOrWhiteSpace(f.Environment)) q = q.Where(e => e.Environment == f.Environment);
        if (!string.IsNullOrWhiteSpace(f.ServiceName)) q = q.Where(e => e.ServiceName == f.ServiceName);
        return q;
    }
    private async Task<IReadOnlyList<ExpenseRow>> RowsAsync(List<Expense> rows, CancellationToken ct)
    {
        var ids = rows.Select(e => e.Id).ToArray();
        var evidence = await db.ExpenseAttachments.AsNoTracking().Where(a => ids.Contains(a.ExpenseId) && a.State == ExpenseAttachmentState.Available)
            .Select(a => new { a.ExpenseId, Info = new ExpenseAttachmentInfo(a.Id, a.FileName, a.ContentType, a.Bytes, a.CreatedAtUtc) }).ToListAsync(ct);
        var byExpense = evidence.ToLookup(a => a.ExpenseId, a => a.Info);
        return rows.Select(e => new ExpenseRow(e, byExpense[e.Id].ToArray())).ToArray();
    }
    public async Task<ExpenseRow> GetAsync(long id, CancellationToken ct)
    {
        var row = await db.Expenses.AsNoTracking().SingleOrDefaultAsync(e => e.Id == id && e.DeletedAtUtc == null, ct) ?? throw new ExpenseNotFoundException();
        return (await RowsAsync([row], ct)).Single();
    }
    public async Task<IReadOnlyList<ExpenseRow>> DueAsync(DateOnly asOf, CancellationToken ct)
    {
        // A schedule advances when a forecast is materialized, before payment. Remind from the
        // outstanding forecast rows, not that generation cursor; never treat Azure usage as a payment due.
        var through = asOf.AddDays(30);
        var rows = await db.Expenses.AsNoTracking().Where(e => e.DeletedAtUtc == null && e.Status == ExpenseStatus.Estimated
            && e.Source != ExpenseSource.Azure && e.Kind == ExpenseKind.Charge && e.OccurredOn <= through)
            .OrderBy(e => e.OccurredOn).ThenBy(e => e.Id).Take(100).ToListAsync(ct);
        return await RowsAsync(rows, ct);
    }
    public async Task<ExpensePage> ListAsync(ExpenseFilter f, CancellationToken ct)
    {
        var q = Query(f); if (f.Cursor is { } cursor) q = q.Where(e => e.Id < cursor);
        var rows = await q.OrderByDescending(e => e.Id).Take(f.Limit + 1).ToListAsync(ct);
        var more = rows.Count > f.Limit; if (more) rows.RemoveAt(rows.Count - 1);
        return new ExpensePage(await RowsAsync(rows, ct), more ? rows[^1].Id : null);
    }
    public async Task<IReadOnlyList<ExpenseRow>> ExportAsync(ExpenseFilter f, CancellationToken ct)
    {
        var rows = await Query(f).OrderBy(e => e.Id).Take(10_001).ToListAsync(ct);
        if (rows.Count > 10_000) throw new ExpenseRequestException("expenseExportTooLarge", "Choose a narrower period or filter (maximum 10,000 rows).");
        return await RowsAsync(rows, ct);
    }
    public async Task<ExpenseSummary> SummaryAsync(ExpenseFilter f, CancellationToken ct)
    {
        // These are separate ledgers: never combine currencies or add estimates to actual payments.
        var q = Query(f).Where(e => e.Status != ExpenseStatus.Cancelled && e.ReconciledByExpenseId == null && !e.NoLongerReported);
        var totals = await q.GroupBy(e => new { e.Currency, e.Status }).Select(g => new {
            g.Key.Currency, g.Key.Status, Gross = g.Sum(e => e.GrossAmount), Net = g.Sum(e => e.NetAmount), Tax = g.Sum(e => e.TaxAmount),
            Rows = g.Count(), UnknownTax = g.Count(e => e.TaxAmount == null) }).ToListAsync(ct);
        var missing = await q.Where(e => !db.ExpenseAttachments.Any(a => a.ExpenseId == e.Id && a.State == ExpenseAttachmentState.Available))
            .GroupBy(e => new { e.Currency, e.Status }).Select(g => new { g.Key.Currency, g.Key.Status, Count = g.Count() }).ToListAsync(ct);
        var months = await q.GroupBy(e => new { e.Currency, e.Status, e.OccurredOn.Year, e.OccurredOn.Month })
            .Select(g => new { g.Key.Currency, g.Key.Status, g.Key.Year, g.Key.Month, Gross = g.Sum(e => e.GrossAmount) }).ToListAsync(ct);
        var categories = await q.GroupBy(e => new { e.Currency, e.Status, e.Category })
            .Select(g => new { g.Key.Currency, g.Key.Status, g.Key.Category, Gross = g.Sum(e => e.GrossAmount) }).ToListAsync(ct);
        var services = await q.GroupBy(e => new { e.Currency, e.Status, e.ServiceName })
            .Select(g => new { g.Key.Currency, g.Key.Status, g.Key.ServiceName, Gross = g.Sum(e => e.GrossAmount) }).ToListAsync(ct);
        return new ExpenseSummary(totals.Select(g => new ExpenseTotal(g.Currency, g.Status, g.Gross, g.UnknownTax == g.Rows ? null : g.Net,
            g.UnknownTax == g.Rows ? null : g.Tax, g.Rows, missing.FirstOrDefault(m => m.Currency == g.Currency && m.Status == g.Status)?.Count ?? 0, g.UnknownTax)).ToArray(),
            months.Select(g => new ExpenseBreakdown(g.Currency, $"{g.Year:D4}-{g.Month:D2}", g.Status, g.Gross)).ToArray(),
            categories.Select(g => new ExpenseBreakdown(g.Currency, g.Category.ToString(), g.Status, g.Gross)).ToArray(),
            services.Select(g => new ExpenseBreakdown(g.Currency, g.ServiceName ?? "Manual", g.Status, g.Gross)).ToArray());
    }
    private async Task LockExpenseAsync(long id, CancellationToken ct) =>
        _ = await db.Database.SqlQuery<long>($"SELECT [Id] AS [Value] FROM [admin].[Expenses] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").ToListAsync(ct);
    public async Task<ExpenseRow> SaveAsync(long actor, long? id, ExpenseWrite command, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (id is { } existingId) await LockExpenseAsync(existingId, ct);
        Expense? row = id is { } rowId ? await db.Expenses.SingleOrDefaultAsync(e => e.Id == rowId && e.DeletedAtUtc == null, ct) : null;
        if (id is not null && row is null) throw new ExpenseNotFoundException();
        if (row?.Source == ExpenseSource.Azure) throw new ExpenseRequestException("importedExpenseReadOnly", "Azure amounts are source-controlled; use reconciliation instead.");
        var duplicate = await db.Expenses.AsNoTracking().SingleOrDefaultAsync(e => e.RequestId == command.RequestId, ct);
        if (id is null && duplicate is not null)
        {
            if (duplicate.DeletedAtUtc is not null || duplicate.Values() != command.Values) throw new ExpenseRequestException("expenseConflict", "The request ID was already used with different data.");
            return (await RowsAsync([duplicate], ct)).Single();
        }
        if (row is not null && (row.Revision != command.ExpectedRevision || row.RequestId != command.RequestId)) Conflict();
        if (command.Values.Kind == ExpenseKind.Refund)
        {
            var originalId = command.Values.OriginalExpenseId!.Value;
            await LockExpenseAsync(originalId, ct);
            var original = await db.Expenses.AsNoTracking().SingleOrDefaultAsync(e => e.Id == originalId && e.DeletedAtUtc == null, ct);
            if (original is null || original.Status != ExpenseStatus.Paid || original.Kind != ExpenseKind.Charge || original.Currency != command.Values.Currency || original.Id == id)
                ExpenseRules.Fail("Refund must refer to a paid charge in the same currency.");
            var refunded = await db.Expenses.Where(e => e.OriginalExpenseId == originalId && e.DeletedAtUtc == null && e.Status != ExpenseStatus.Cancelled && e.Id != (id ?? 0)).SumAsync(e => e.GrossAmount, ct);
            if (-refunded - command.Values.GrossAmount > original!.GrossAmount) ExpenseRules.Fail("Refunds exceed the original payment.");
        }
        if (id is { } parentId)
        {
            var refunds = await db.Expenses.Where(e => e.OriginalExpenseId == parentId && e.DeletedAtUtc == null && e.Status != ExpenseStatus.Cancelled).SumAsync(e => e.GrossAmount, ct);
            if (refunds < 0 && (command.Values.Status != ExpenseStatus.Paid || command.Values.Kind != ExpenseKind.Charge || command.Values.GrossAmount < -refunds || command.Values.Currency != row!.Currency))
                ExpenseRules.Fail("Resolve linked refunds before cancelling or reducing this charge.");
        }
        var before = row is null ? null : Snapshot(row);
        var key = row?.Source == ExpenseSource.Recurring ? row.DeduplicationKey : ExpenseRules.ManualKey(command);
        if (await db.Expenses.AnyAsync(e => e.DeduplicationKey == key && e.Id != (id ?? 0), ct))
            throw new ExpenseRequestException("expenseDuplicate", "This invoice or request is already recorded, including its retained history.");
        var now = time.GetUtcNow();
        if (row is null) { row = new Expense(command.RequestId, ExpenseSource.Manual, key, command.Values, actor, now); db.Expenses.Add(row); }
        else { row.Apply(command.Values, now); row.SetDeduplicationKey(key); }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new ExpenseRequestException("expenseConflict", "The expense changed. Reload before editing."); }
        catch (DbUpdateException e) when (Duplicate(e)) { throw new ExpenseRequestException("expenseDuplicate", "This invoice or request is already recorded."); }
        if (command.Frequency is { } frequency)
        {
            if (id is not null || row.Kind != ExpenseKind.Charge) ExpenseRules.Fail("Create a schedule with the original expense; pause it separately.");
            db.ExpenseRecurringSchedules.Add(new ExpenseRecurringSchedule(row.Id, frequency, command.NextDueOn!.Value));
        }
        var related = await db.Expenses.Where(e => e.ReconciledByExpenseId == row.Id).ToListAsync(ct);
        if (command.ReconcilesExpenseIds is { } selected)
        {
            if (selected.Contains(row.Id)) ExpenseRules.Fail("An invoice cannot reconcile itself.");
            var ids = selected.Distinct().ToArray();
            var imported = await db.Expenses.Where(e => ids.Contains(e.Id)).ToListAsync(ct);
            if (imported.Count != ids.Length || imported.Any(e => e.Source != ExpenseSource.Azure || e.DeletedAtUtc != null || e.NoLongerReported || e.ReconciledByExpenseId is { } invoice && invoice != row.Id))
                ExpenseRules.Fail("Select available Azure rows that are not reconciled to another invoice.");
            foreach (var old in related.Where(e => !ids.Contains(e.Id))) { var previous = Snapshot(old); old.Reconcile(null, now); Audit(actor, "expense.unreconciled", old.Id, previous, Snapshot(old)); }
            foreach (var importedRow in imported.Where(e => e.ReconciledByExpenseId != row.Id)) { var previous = Snapshot(importedRow); importedRow.Reconcile(row.Id, now); Audit(actor, "expense.reconciled", importedRow.Id, previous, Snapshot(importedRow)); }
            related = imported;
        }
        if (related.Count > 0 && (row.Status != ExpenseStatus.Paid || row.Kind != ExpenseKind.Charge || row.Provider != "Microsoft Azure" || related.Any(e => e.Currency != row.Currency)))
            ExpenseRules.Fail("Reconciliation requires a paid Microsoft Azure invoice in the same currency; taxes must be entered from the invoice, not inferred.");
        Audit(actor, before is null ? "expense.created" : "expense.updated", row.Id, before, Snapshot(row));
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new ExpenseRequestException("expenseConflict", "A related record changed. Reload before editing."); }
        return (await RowsAsync([row], ct)).Single();
    }
    public async Task DeleteAsync(long actor, long id, long revision, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockExpenseAsync(id, ct);
        var row = await db.Expenses.SingleOrDefaultAsync(e => e.Id == id && e.DeletedAtUtc == null, ct) ?? throw new ExpenseNotFoundException();
        if (row.Source == ExpenseSource.Azure) throw new ExpenseRequestException("importedExpenseReadOnly", "Azure rows are reconciled rather than manually deleted.");
        if (row.Revision != revision) Conflict();
        if (await db.Expenses.AnyAsync(e => e.OriginalExpenseId == id && e.DeletedAtUtc == null && e.Status != ExpenseStatus.Cancelled, ct)) ExpenseRules.Fail("Remove or cancel the linked refund first.");
        var before = Snapshot(row); var now = time.GetUtcNow(); row.Delete(now);
        foreach (var linked in await db.Expenses.Where(e => e.ReconciledByExpenseId == id).ToListAsync(ct))
        { var old = Snapshot(linked); linked.Reconcile(null, now); Audit(actor, "expense.unreconciled", linked.Id, old, Snapshot(linked)); }
        foreach (var schedule in await db.ExpenseRecurringSchedules.Where(s => s.TemplateExpenseId == id && s.IsEnabled).ToListAsync(ct)) schedule.Disable();
        foreach (var file in await db.ExpenseAttachments.Where(a => a.ExpenseId == id && a.State != ExpenseAttachmentState.Deleted).ToListAsync(ct)) file.Mark(ExpenseAttachmentState.CleanupPending);
        Audit(actor, "expense.deleted", id, before, Snapshot(row));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<IReadOnlyList<ExpenseAuditLog>> AuditAsync(long id, long? cursor, CancellationToken ct) =>
        await db.ExpenseAuditLogs.AsNoTracking().Where(a => a.ExpenseId == id && (cursor == null || a.Id < cursor)).OrderByDescending(a => a.Id).Take(100).ToListAsync(ct);
    public async Task<IReadOnlyList<ExpenseScheduleInfo>> SchedulesAsync(CancellationToken ct) =>
        await (from s in db.ExpenseRecurringSchedules.AsNoTracking() join e in db.Expenses.AsNoTracking() on s.TemplateExpenseId equals e.Id
            where e.DeletedAtUtc == null orderby s.NextDueOn select new ExpenseScheduleInfo(s, e.Name, e.Provider, e.Currency, e.GrossAmount)).Take(1000).ToListAsync(ct);
    public async Task DisableScheduleAsync(long actor, long id, long revision, CancellationToken ct)
    {
        var row = await db.ExpenseRecurringSchedules.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new ExpenseNotFoundException();
        if (row.Revision != revision) Conflict(); row.Disable();
        Audit(actor, "expense.schedule_disabled", row.TemplateExpenseId, null, JsonSerializer.Serialize(new { scheduleId = id }, Json));
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { Conflict(); }
    }
    public async Task<int> MaterializeAsync(long? actor, DateOnly through, CancellationToken ct)
    {
        var ids = await db.ExpenseRecurringSchedules.AsNoTracking().Where(s => s.IsEnabled && s.NextDueOn <= through).OrderBy(s => s.Id).Select(s => s.Id).Take(100).ToListAsync(ct);
        var count = 0;
        foreach (var id in ids)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            _ = await db.Database.SqlQuery<long>($"SELECT [Id] AS [Value] FROM [admin].[ExpenseRecurringSchedules] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").ToListAsync(ct);
            var schedule = await db.ExpenseRecurringSchedules.SingleAsync(s => s.Id == id, ct);
            // Reload matters when the same scoped context handled an earlier manual operation.
            await db.Entry(schedule).ReloadAsync(ct);
            var template = await db.Expenses.AsNoTracking().SingleAsync(e => e.Id == schedule.TemplateExpenseId, ct);
            for (var batch = 0; schedule.IsEnabled && template.DeletedAtUtc is null && schedule.NextDueOn <= through && batch < 24; batch++)
            {
                var due = schedule.NextDueOn;
                var key = ExpenseRules.Hash($"recurring:{id}:{due:yyyy-MM-dd}");
                if (!await db.Expenses.AnyAsync(e => e.DeduplicationKey == key, ct))
                {
                    var values = template.Values() with { OccurredOn = due, PaidOn = null, Status = ExpenseStatus.Estimated, InvoiceReference = null,
                        ConvertedCurrency = null, ExchangeRate = null, ExchangeRateOn = null };
                    var expense = new Expense(Guid.NewGuid(), ExpenseSource.Recurring, key, values, actor, time.GetUtcNow());
                    db.Expenses.Add(expense); await db.SaveChangesAsync(ct);
                    Audit(actor, "expense.projected", expense.Id, null, Snapshot(expense)); count++;
                }
                schedule.Advance();
            }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
        return count;
    }
    public async Task<ExpenseLease?> AcquireSyncAsync(ExpenseAzureScope scope, DateOnly month, DateTimeOffset now, CancellationToken ct)
    {
        var key = ExpenseRules.Hash($"{scope.Scope.ToLowerInvariant()}:{month:yyyy-MM}");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        _ = await db.Database.SqlQuery<long>($"SELECT [Id] AS [Value] FROM [admin].[ExpenseSyncRuns] WITH (UPDLOCK,HOLDLOCK) WHERE [LeaseKey]={key}").ToListAsync(ct);
        var row = await db.ExpenseSyncRuns.SingleOrDefaultAsync(s => s.LeaseKey == key, ct);
        if (row is not null) await db.Entry(row).ReloadAsync(ct);
        if (row?.LeaseUntilUtc > now) return null;
        if (row is null) { row = new ExpenseSyncRun(scope.Scope, scope.Environment, month, key); db.ExpenseSyncRuns.Add(row); }
        var lease = row.Start(now); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new ExpenseLease(row.Id, lease, row.Scope, row.Environment, row.Month);
    }
    public async Task ApplySyncAsync(ExpenseLease lease, IReadOnlyList<AzureExpenseCost> costs, DateTimeOffset now, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        _ = await db.Database.SqlQuery<long>($"SELECT [Id] AS [Value] FROM [admin].[ExpenseSyncRuns] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={lease.RunId}").ToListAsync(ct);
        var run = await db.ExpenseSyncRuns.SingleAsync(s => s.Id == lease.RunId, ct); await db.Entry(run).ReloadAsync(ct);
        if (run.LeaseId != lease.LeaseId || run.LeaseUntilUtc <= now) throw new ExpenseRequestException("expenseSyncBusy", "The synchronization lease expired.");
        var parts = lease.Scope.Split('/'); var subscriptionId = parts[2]; var resourceGroup = parts[4];
        var rows = await db.Expenses.Where(e => e.Source == ExpenseSource.Azure && e.SubscriptionId == subscriptionId && e.ResourceGroup == resourceGroup
            && e.OccurredOn >= lease.Month && e.OccurredOn < lease.Month.AddMonths(1)).ToListAsync(ct);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var byKey = rows.ToDictionary(e => e.DeduplicationKey, StringComparer.Ordinal);
        var changes = new List<(Expense Row, string? Before)>();
        foreach (var cost in costs)
        {
            var key = ExpenseRules.AzureKey(lease.Scope, cost); keys.Add(key);
            byKey.TryGetValue(key, out var row);
            var before = row is null ? null : Snapshot(row);
            var values = ExpenseRules.Validate(new ExpenseValues(cost.ServiceName, "Microsoft Azure", ExpenseCategory.Cloud, cost.Date,
                null, cost.Currency, null, null, decimal.Round(cost.Amount, 12), "Azure billing", ExpenseStatus.Estimated,
                cost.Amount < 0 ? ExpenseKind.Adjustment : ExpenseKind.Charge, null, "Cost Management usage; not an invoice. Tax/credits require invoice reconciliation."));
            if (row is null) { row = new Expense(Guid.NewGuid(), ExpenseSource.Azure, key, values, null, now); db.Expenses.Add(row); }
            else row.Apply(values, now);
            row.SetAzureDetails(subscriptionId, resourceGroup, cost.ServiceName, lease.Environment, cost.RawAmount);
            changes.Add((row, before));
        }
        foreach (var gone in rows.Where(e => !keys.Contains(e.DeduplicationKey) && !e.NoLongerReported))
        { var before = Snapshot(gone); gone.MarkNoLongerReported(now); Audit(null, "expense.azure_removed", gone.Id, before, Snapshot(gone)); }
        run.Finish(now, costs.Count);
        await db.SaveChangesAsync(ct);
        foreach (var change in changes)
            Audit(null, change.Before is null ? "expense.azure_imported" : "expense.azure_refreshed", change.Row.Id, change.Before, Snapshot(change.Row));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task FailSyncAsync(ExpenseLease lease, string code, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var run = await db.ExpenseSyncRuns.SingleOrDefaultAsync(s => s.Id == lease.RunId && s.LeaseId == lease.LeaseId, ct);
        if (run is null) return; run.Fail(code); await db.SaveChangesAsync(ct);
    }
    public async Task<IReadOnlyList<ExpenseSyncRun>> SyncRunsAsync(CancellationToken ct) =>
        await db.ExpenseSyncRuns.AsNoTracking().OrderByDescending(s => s.LastStartedAtUtc).Take(200).ToListAsync(ct);
    public async Task<ExpenseAttachment> BeginAttachmentAsync(long actor, long expenseId, Guid requestId, string name, string type, string sha256, long bytes, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockExpenseAsync(expenseId, ct);
        if (!await db.Expenses.AnyAsync(e => e.Id == expenseId && e.DeletedAtUtc == null, ct)) throw new ExpenseNotFoundException();
        var existing = await db.ExpenseAttachments.SingleOrDefaultAsync(a => a.RequestId == requestId, ct);
        if (existing is not null)
        {
            if (existing.ExpenseId != expenseId || existing.Sha256 != sha256 || existing.State != ExpenseAttachmentState.Available)
                throw new ExpenseRequestException("expenseConflict", "Upload already used or still pending; retry with a fresh upload ID after cleanup.");
            return existing;
        }
        var extension = type == "application/pdf" ? ".pdf" : type == "image/png" ? ".png" : ".jpg";
        var row = new ExpenseAttachment(expenseId, requestId, name, type, $"expenses/{expenseId}/{Guid.NewGuid():N}{extension}", sha256, bytes, time.GetUtcNow());
        db.ExpenseAttachments.Add(row);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (Duplicate(e)) { throw new ExpenseRequestException("expenseDuplicate", "This evidence or upload request is already recorded."); }
        await tx.CommitAsync(ct); return row;
    }
    public async Task CompleteAttachmentAsync(long actor, long id, CancellationToken ct)
    {
        var expenseId = await db.ExpenseAttachments.Where(a => a.Id == id).Select(a => a.ExpenseId).SingleAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockExpenseAsync(expenseId, ct);
        var row = await db.ExpenseAttachments.SingleAsync(a => a.Id == id, ct);
        await db.Entry(row).ReloadAsync(ct);
        if (!await db.Expenses.AnyAsync(e => e.Id == row.ExpenseId && e.DeletedAtUtc == null, ct)) throw new ExpenseNotFoundException();
        if (row.State != ExpenseAttachmentState.Pending) Conflict();
        row.Mark(ExpenseAttachmentState.Available); Audit(actor, "expense.evidence_added", row.ExpenseId, null, JsonSerializer.Serialize(new { attachmentId = row.Id, row.Sha256 }, Json));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<ExpenseAttachment> GetAttachmentAsync(long expenseId, long attachmentId, CancellationToken ct) =>
        await db.ExpenseAttachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == attachmentId && a.ExpenseId == expenseId && a.State == ExpenseAttachmentState.Available
            && db.Expenses.Any(e => e.Id == expenseId && e.DeletedAtUtc == null), ct) ?? throw new ExpenseNotFoundException();
    public async Task<ExpenseAttachment> DeleteAttachmentAsync(long actor, long expenseId, long attachmentId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockExpenseAsync(expenseId, ct);
        var row = await db.ExpenseAttachments.SingleOrDefaultAsync(a => a.Id == attachmentId && a.ExpenseId == expenseId && a.State == ExpenseAttachmentState.Available
            && db.Expenses.Any(e => e.Id == expenseId && e.DeletedAtUtc == null), ct) ?? throw new ExpenseNotFoundException();
        row.Mark(ExpenseAttachmentState.CleanupPending); Audit(actor, "expense.evidence_deleted", expenseId, JsonSerializer.Serialize(new { attachmentId }, Json), null);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return row;
    }
    public async Task<IReadOnlyList<ExpenseAttachment>> PendingCleanupAsync(DateTimeOffset before, CancellationToken ct) =>
        await db.ExpenseAttachments.AsNoTracking().Where(a => a.State == ExpenseAttachmentState.CleanupPending || a.State == ExpenseAttachmentState.Pending && a.CreatedAtUtc < before).OrderBy(a => a.Id).Take(100).ToListAsync(ct);
    public async Task MarkAttachmentDeletedAsync(long id, CancellationToken ct) =>
        _ = await db.ExpenseAttachments.Where(a => a.Id == id && a.State != ExpenseAttachmentState.Available).ExecuteUpdateAsync(s => s.SetProperty(a => a.State, ExpenseAttachmentState.Deleted), ct);
    private static bool Duplicate(DbUpdateException e) => e.InnerException is SqlException { Number: 2601 or 2627 };
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Conflict() => throw new ExpenseRequestException("expenseConflict", "This record changed. Reload before editing.");
}
