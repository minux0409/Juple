using Juple.Domain.Expenses;

namespace Juple.Application.Expenses;

public sealed class ExpenseOptions
{
    public bool Enabled { get; set; }
    public bool AzureSyncEnabled { get; set; }
    public bool AzureInsightsEnabled { get; set; }
    public List<ExpenseAzureScope> AzureScopes { get; set; } = [];
    public string? ClamAvHost { get; set; }
    public int ClamAvPort { get; set; } = 3310;
    public const long MaxAttachmentBytes = 10 * 1024 * 1024;
}
public sealed record ExpenseAzureScope(string Scope, string Environment, bool AllowWholeSubscription = false);
public sealed record ExpenseWrite(Guid RequestId, ExpenseValues Values, long? ExpectedRevision = null,
    ExpenseFrequency? Frequency = null, DateOnly? NextDueOn = null, IReadOnlyList<long>? ReconcilesExpenseIds = null);
public sealed record ExpenseFilter(DateOnly From, DateOnly Through, ExpenseCategory? Category = null,
    string? Provider = null, string? PaymentMethod = null, string? Currency = null, ExpenseStatus? Status = null,
    string? Environment = null, string? ServiceName = null, long? Cursor = null, int Limit = 50,
    string? Search = null, string Sort = "newest");
public sealed record ExpenseRow(Expense Expense, IReadOnlyList<ExpenseAttachmentInfo> Attachments);
public sealed record ExpenseAttachmentInfo(long Id, string FileName, string ContentType, long Bytes, DateTimeOffset CreatedAtUtc);
public sealed record ExpensePage(IReadOnlyList<ExpenseRow> Items, long? NextCursor);
public sealed record ExpenseTotal(string Currency, ExpenseStatus Status, decimal Gross, decimal? Net, decimal? Tax, int Rows, int MissingEvidence, int UnknownTax);
public sealed record ExpenseBreakdown(string Currency, string Label, ExpenseStatus Status, decimal Gross);
public sealed record ExpenseSummary(IReadOnlyList<ExpenseTotal> Totals, IReadOnlyList<ExpenseBreakdown> Months,
    IReadOnlyList<ExpenseBreakdown> Categories, IReadOnlyList<ExpenseBreakdown> Services)
{
    public IReadOnlyList<ExpenseBreakdown> Days { get; init; } = [];
    public IReadOnlyList<ExpenseBreakdown> Sources { get; init; } = [];
}
public sealed record ExpenseScheduleInfo(ExpenseRecurringSchedule Schedule, string Name, string Provider, string Currency, decimal GrossAmount);
public sealed record AzureExpenseCost(DateOnly Date, string ServiceName, string Currency, decimal Amount, string RawAmount);
public sealed record ExpenseLease(long RunId, Guid LeaseId, string Scope, string Environment, DateOnly Month);
public sealed class ExpenseRequestException(string code, string message) : Exception(message) { public string Code { get; } = code; }
public sealed class ExpenseForbiddenException : Exception;
public sealed class ExpenseNotFoundException : Exception;

public interface IExpenseStore
{
    Task<ExpenseRow> GetAsync(long id, CancellationToken ct);
    Task<IReadOnlyList<ExpenseRow>> DueAsync(DateOnly asOf, CancellationToken ct);
    Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken ct);
    Task<ExpenseSummary> SummaryAsync(ExpenseFilter filter, CancellationToken ct);
    Task<IReadOnlyList<ExpenseRow>> ExportAsync(ExpenseFilter filter, CancellationToken ct);
    Task<ExpenseRow> SaveAsync(long adminId, long? id, ExpenseWrite command, CancellationToken ct);
    Task DeleteAsync(long adminId, long id, long revision, CancellationToken ct);
    Task<IReadOnlyList<ExpenseAuditLog>> AuditAsync(long id, long? cursor, CancellationToken ct);
    Task<IReadOnlyList<ExpenseScheduleInfo>> SchedulesAsync(CancellationToken ct);
    Task DisableScheduleAsync(long adminId, long id, long revision, CancellationToken ct);
    Task<int> MaterializeAsync(long? adminId, DateOnly through, CancellationToken ct);
    Task<ExpenseLease?> AcquireSyncAsync(ExpenseAzureScope scope, DateOnly month, DateTimeOffset now, CancellationToken ct);
    Task ApplySyncAsync(ExpenseLease lease, IReadOnlyList<AzureExpenseCost> rows, DateTimeOffset now, CancellationToken ct);
    Task FailSyncAsync(ExpenseLease lease, string code, CancellationToken ct);
    Task<IReadOnlyList<ExpenseSyncRun>> SyncRunsAsync(CancellationToken ct);
    Task<ExpenseAttachment> BeginAttachmentAsync(long adminId, long expenseId, Guid requestId, string fileName, string contentType, string sha256, long bytes, CancellationToken ct);
    Task CompleteAttachmentAsync(long adminId, long id, CancellationToken ct);
    Task<ExpenseAttachment> GetAttachmentAsync(long expenseId, long attachmentId, CancellationToken ct);
    Task<ExpenseAttachment> DeleteAttachmentAsync(long adminId, long expenseId, long attachmentId, CancellationToken ct);
    Task<IReadOnlyList<ExpenseAttachment>> PendingCleanupAsync(DateTimeOffset before, CancellationToken ct);
    Task MarkAttachmentDeletedAsync(long id, CancellationToken ct);
}
public interface IAzureExpenseSource { Task<IReadOnlyList<AzureExpenseCost>> QueryAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct); }
public sealed record AzureCostPoint(DateOnly Date, string Label, string Currency, decimal Amount);
public sealed record AzureCostDetail(string Status, IReadOnlyList<AzureCostPoint> Points);
public interface IAzureCostDetailsSource
{
    Task<AzureCostDetail> ResourcesAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct);
    Task<AzureCostDetail> ForecastAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct);
}
public sealed record AzureMonthCost(string Currency, decimal? Current, decimal? PreviousSameDays, decimal? PreviousFullMonth, decimal? ChangePercent);
public sealed record AzureCostReport(string Scope, DateOnly Month, DateOnly Through, DateTimeOffset? LastSyncAtUtc,
    string SyncStatus, string? FailureCode, IReadOnlyList<AzureMonthCost> Totals,
    IReadOnlyList<AzureCostPoint> Services, AzureCostDetail Resources, AzureCostDetail Forecast);
/// <summary>One amount in its original currency (no conversion, no cross-currency total).</summary>
public sealed record AzureCurrencyAmount(string Currency, decimal Amount);
/// <summary>
/// One Azure billing month (UTC usage dates). Synced = the month has a successful import, so Amounts is the imported usage cost
/// (empty = really nothing was billed); not synced = unknown, never zero. IsCurrent = the month is still running.
/// </summary>
public sealed record AzureMonthlyCost(DateOnly Month, bool IsCurrent, bool Synced, DateTimeOffset? LastSyncAtUtc, string SyncStatus,
    string? FailureCode, IReadOnlyList<AzureCurrencyAmount> Amounts);
public sealed record AzureCostHistory(string Scope, string Environment, DateOnly TodayUtc, IReadOnlyList<AzureMonthlyCost> Months);
public interface IAzureCostReportStore
{
    Task<AzureCostReport> ReadAsync(ExpenseAzureScope scope, DateOnly month, DateOnly todayUtc, CancellationToken ct);
    /// <summary>The imported Azure usage cost per billing month and currency, from fromMonth through the current month.</summary>
    Task<AzureCostHistory> MonthlyAsync(ExpenseAzureScope scope, DateOnly? fromMonth, DateOnly todayUtc, CancellationToken ct);
}
public interface IExpenseEvidenceScanner { Task ScanAsync(ReadOnlyMemory<byte> bytes, CancellationToken ct); }
public interface IExpenseEvidenceFiles
{
    Task PutAsync(string blobName, ReadOnlyMemory<byte> bytes, string contentType, CancellationToken ct);
    Task<Stream> OpenAsync(string blobName, CancellationToken ct);
    Task DeleteAsync(string blobName, CancellationToken ct);
}
