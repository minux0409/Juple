using Juple.Application.Admin;
using Juple.Domain.Admin;
using Juple.Domain.Expenses;

namespace Juple.Application.Expenses;

public sealed class ExpenseService(IExpenseStore store, IAdminAccessStore admins, ExpenseOptions options, TimeProvider time)
{
    public async Task<ExpenseRow> GetAsync(long actor, long id, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); return await store.GetAsync(id, ct); }
    public async Task<IReadOnlyList<ExpenseRow>> DueAsync(long actor, DateOnly asOf, CancellationToken ct)
    {
        await RequireAdminAsync(actor, ct);
        if (asOf.Year is < 2000 or > 2100) ExpenseRules.Fail("Choose a valid reminder date.");
        return await store.DueAsync(asOf, ct);
    }
    public async Task RequireAdminAsync(long actor, CancellationToken ct)
    {
        var access = await admins.FindActiveAsync(actor, ct);
        if (access is null || access.Role is not (AdminRole.Owner or AdminRole.Admin)) throw new ExpenseForbiddenException();
        if (!options.Enabled) throw new ExpenseRequestException("expensesDisabled", "Expense management is not configured.");
    }
    public async Task<ExpensePage> ListAsync(long actor, ExpenseFilter filter, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); ExpenseRules.Validate(filter); return await store.ListAsync(filter, ct); }
    public async Task<ExpenseSummary> SummaryAsync(long actor, ExpenseFilter filter, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); ExpenseRules.Validate(filter); return await store.SummaryAsync(filter, ct); }
    public async Task<IReadOnlyList<ExpenseRow>> ExportAsync(long actor, ExpenseFilter filter, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); ExpenseRules.Validate(filter); return await store.ExportAsync(filter, ct); }
    public async Task<ExpenseRow> SaveAsync(long actor, long? id, ExpenseWrite command, CancellationToken ct)
    {
        await RequireAdminAsync(actor, ct);
        if (command.RequestId == Guid.Empty || id is not null && command.ExpectedRevision is null) ExpenseRules.Fail("Request ID and edit revision are required.");
        var normalized = command with { Values = ExpenseRules.Validate(command.Values) };
        if ((command.Frequency is null) != (command.NextDueOn is null)) ExpenseRules.Fail("A recurring cost needs its next due date and frequency.");
        if (id is not null && command.Frequency is not null) ExpenseRules.Fail("Pause the existing schedule separately; do not recreate it while editing.");
        if (command.Frequency is { } frequency && (!Enum.IsDefined(frequency) || command.NextDueOn <= command.Values.OccurredOn || command.Values.Kind != ExpenseKind.Charge)) ExpenseRules.Fail("Invalid recurring schedule.");
        if (command.ReconcilesExpenseIds?.Count > 500) ExpenseRules.Fail("Reconcile at most 500 imported rows at once.");
        return await store.SaveAsync(actor, id, normalized, ct);
    }
    public async Task DeleteAsync(long actor, long id, long revision, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); await store.DeleteAsync(actor, id, revision, ct); }
    public async Task<IReadOnlyList<ExpenseAuditLog>> AuditAsync(long actor, long id, long? cursor, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); return await store.AuditAsync(id, cursor, ct); }
    public async Task<IReadOnlyList<ExpenseScheduleInfo>> SchedulesAsync(long actor, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); return await store.SchedulesAsync(ct); }
    public async Task DisableScheduleAsync(long actor, long id, long revision, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); await store.DisableScheduleAsync(actor, id, revision, ct); }
    public async Task<int> MaterializeAsync(long? actor, DateOnly through, CancellationToken ct)
    {
        if (actor is { } admin) await RequireAdminAsync(admin, ct);
        else if (!options.Enabled) return 0;
        if (through > DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime).AddDays(90)) ExpenseRules.Fail("Only the next 90 days may be projected.");
        return await store.MaterializeAsync(actor, through, ct);
    }
    public async Task<IReadOnlyList<ExpenseSyncRun>> SyncRunsAsync(long actor, CancellationToken ct)
    { await RequireAdminAsync(actor, ct); return await store.SyncRunsAsync(ct); }
}
