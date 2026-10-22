using System.Text.Json.Serialization;
namespace Juple.Domain.Expenses;

[JsonConverter(typeof(JsonStringEnumConverter<ExpenseCategory>))]
public enum ExpenseCategory { Cloud, DeveloperProgram, Domain, Software, Design, Advertising, Fees, Other, AppleDeveloper, GooglePlayConsole, EmailSmsApi, Accounting }
[JsonConverter(typeof(JsonStringEnumConverter<ExpenseStatus>))]
public enum ExpenseStatus { Estimated, Paid, Cancelled, Provisional }
[JsonConverter(typeof(JsonStringEnumConverter<ExpenseKind>))]
public enum ExpenseKind { Charge, Refund, Adjustment }
[JsonConverter(typeof(JsonStringEnumConverter<ExpenseSource>))]
public enum ExpenseSource { Manual, Recurring, Azure }
[JsonConverter(typeof(JsonStringEnumConverter<ExpenseFrequency>))]
public enum ExpenseFrequency { Monthly, Yearly }

public sealed record ExpenseValues(
    string Name, string Provider, ExpenseCategory Category, DateOnly OccurredOn, DateOnly? PaidOn,
    string Currency,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? NetAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? TaxAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal GrossAmount, string PaymentMethod,
    ExpenseStatus Status, ExpenseKind Kind, string? InvoiceReference, string? Memo,
    string? ConvertedCurrency = null,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? ExchangeRate = null, DateOnly? ExchangeRateOn = null,
    long? OriginalExpenseId = null, string? CustomCategory = null, DateOnly? PeriodFrom = null,
    DateOnly? PeriodThrough = null, string? ExchangeRateSource = null, string? ServiceName = null);

/// <summary>Company ledger, not customer-owned content. Operator identities are retained without account-deletion cascades.</summary>
public sealed class Expense
{
    private Expense() { }
    public Expense(Guid requestId, ExpenseSource source, string deduplicationKey, ExpenseValues values, long? adminUserId, DateTimeOffset now)
    {
        RequestId = requestId; Source = source; DeduplicationKey = deduplicationKey;
        CreatedByAdminUserId = adminUserId; CreatedAtUtc = now; Apply(values, now);
    }
    public long Id { get; private set; }
    public Guid RequestId { get; private set; }
    public ExpenseSource Source { get; private set; }
    public string DeduplicationKey { get; private set; } = null!;
    public string Name { get; private set; } = null!;
    public string Provider { get; private set; } = null!;
    public ExpenseCategory Category { get; private set; }
    public DateOnly OccurredOn { get; private set; }
    public DateOnly? PaidOn { get; private set; }
    public string Currency { get; private set; } = null!;
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)] public decimal? NetAmount { get; private set; }
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)] public decimal? TaxAmount { get; private set; }
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)] public decimal GrossAmount { get; private set; }
    public string PaymentMethod { get; private set; } = null!;
    public ExpenseStatus Status { get; private set; }
    public ExpenseKind Kind { get; private set; }
    public string? InvoiceReference { get; private set; }
    public string? Memo { get; private set; }
    public string? ConvertedCurrency { get; private set; }
    [JsonNumberHandling(JsonNumberHandling.WriteAsString)] public decimal? ExchangeRate { get; private set; }
    public DateOnly? ExchangeRateOn { get; private set; }
    public long? OriginalExpenseId { get; private set; }
    public long? ReconciledByExpenseId { get; private set; }
    public string? SubscriptionId { get; private set; }
    public string? ResourceGroup { get; private set; }
    public string? ServiceName { get; private set; }
    public string? Environment { get; private set; }
    public string? RawImportedAmount { get; private set; }
    public string? CustomCategory { get; private set; }
    public DateOnly? PeriodFrom { get; private set; }
    public DateOnly? PeriodThrough { get; private set; }
    public string? ExchangeRateSource { get; private set; }
    public bool NoLongerReported { get; private set; }
    public long? CreatedByAdminUserId { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public DateTimeOffset? DeletedAtUtc { get; private set; }
    public long Revision { get; private set; }
    public void Apply(ExpenseValues value, DateTimeOffset now)
    {
        Name = value.Name; Provider = value.Provider; Category = value.Category; OccurredOn = value.OccurredOn; PaidOn = value.PaidOn;
        Currency = value.Currency; NetAmount = value.NetAmount; TaxAmount = value.TaxAmount; GrossAmount = value.GrossAmount;
        PaymentMethod = value.PaymentMethod; Status = value.Status; Kind = value.Kind; InvoiceReference = value.InvoiceReference; Memo = value.Memo;
        ConvertedCurrency = value.ConvertedCurrency; ExchangeRate = value.ExchangeRate; ExchangeRateOn = value.ExchangeRateOn;
        OriginalExpenseId = value.OriginalExpenseId; UpdatedAtUtc = now; Revision++;
        CustomCategory = value.CustomCategory; PeriodFrom = value.PeriodFrom; PeriodThrough = value.PeriodThrough;
        ExchangeRateSource = value.ExchangeRateSource;
        if (Source != ExpenseSource.Azure) ServiceName = value.ServiceName;
    }
    public void SetDeduplicationKey(string key) => DeduplicationKey = key;
    public void SetAzureDetails(string subscriptionId, string resourceGroup, string serviceName, string environment, string rawAmount)
    {
        SubscriptionId = subscriptionId; ResourceGroup = resourceGroup; ServiceName = serviceName; Environment = environment;
        RawImportedAmount = rawAmount; NoLongerReported = false;
    }
    public void Reconcile(long? invoiceId, DateTimeOffset now) { ReconciledByExpenseId = invoiceId; UpdatedAtUtc = now; Revision++; }
    public void MarkNoLongerReported(DateTimeOffset now) { NoLongerReported = true; UpdatedAtUtc = now; Revision++; }
    public void Delete(DateTimeOffset now) { DeletedAtUtc = now; UpdatedAtUtc = now; Revision++; }
    public ExpenseValues Values() => new(Name, Provider, Category, OccurredOn, PaidOn, Currency, NetAmount, TaxAmount, GrossAmount,
        PaymentMethod, Status, Kind, InvoiceReference, Memo, ConvertedCurrency, ExchangeRate, ExchangeRateOn, OriginalExpenseId,
        CustomCategory, PeriodFrom, PeriodThrough, ExchangeRateSource, Source == ExpenseSource.Azure ? null : ServiceName);
}

public sealed class ExpenseRecurringSchedule
{
    private ExpenseRecurringSchedule() { }
    public ExpenseRecurringSchedule(long templateExpenseId, ExpenseFrequency frequency, DateOnly nextDueOn)
    { TemplateExpenseId = templateExpenseId; Frequency = frequency; NextDueOn = nextDueOn; AnchorDay = nextDueOn.Day; AnchorMonth = nextDueOn.Month; IsEnabled = true; }
    public long Id { get; private set; }
    public long TemplateExpenseId { get; private set; }
    public ExpenseFrequency Frequency { get; private set; }
    public DateOnly NextDueOn { get; private set; }
    public int AnchorDay { get; private set; }
    public int AnchorMonth { get; private set; }
    public bool IsEnabled { get; private set; }
    public long Revision { get; private set; } = 1;
    public void Disable() { IsEnabled = false; Revision++; }
    public void Advance()
    {
        var next = Frequency == ExpenseFrequency.Monthly ? NextDueOn.AddMonths(1) : new DateOnly(NextDueOn.Year + 1, AnchorMonth, 1);
        NextDueOn = new DateOnly(next.Year, next.Month, Math.Min(AnchorDay, DateTime.DaysInMonth(next.Year, next.Month))); Revision++;
    }
}

[JsonConverter(typeof(JsonStringEnumConverter<ExpenseAttachmentState>))]
public enum ExpenseAttachmentState { Pending, Available, CleanupPending, Deleted }
public sealed class ExpenseAttachment
{
    private ExpenseAttachment() { }
    public ExpenseAttachment(long expenseId, Guid requestId, string fileName, string contentType, string blobName, string sha256, long bytes, DateTimeOffset now)
    { ExpenseId = expenseId; RequestId = requestId; FileName = fileName; ContentType = contentType; BlobName = blobName; Sha256 = sha256; Bytes = bytes; CreatedAtUtc = now; }
    public long Id { get; private set; }
    public long ExpenseId { get; private set; }
    public Guid RequestId { get; private set; }
    public string FileName { get; private set; } = null!;
    public string ContentType { get; private set; } = null!;
    public string BlobName { get; private set; } = null!;
    public string Sha256 { get; private set; } = null!;
    public long Bytes { get; private set; }
    public ExpenseAttachmentState State { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public void Mark(ExpenseAttachmentState state) => State = state;
}

public sealed class ExpenseAuditLog
{
    private ExpenseAuditLog() { }
    public ExpenseAuditLog(long? adminUserId, string action, long? expenseId, string? beforeJson, string? afterJson, DateTimeOffset at)
    { AdminUserId = adminUserId; Action = action; ExpenseId = expenseId; BeforeJson = beforeJson; AfterJson = afterJson; CreatedAtUtc = at; }
    public long Id { get; private set; }
    public long? AdminUserId { get; private set; }
    public string Action { get; private set; } = null!;
    public long? ExpenseId { get; private set; }
    public string? BeforeJson { get; private set; }
    public string? AfterJson { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
}

public sealed class ExpenseSyncRun
{
    private ExpenseSyncRun() { }
    public ExpenseSyncRun(string scope, string environment, DateOnly month, string key)
    { Scope = scope; Environment = environment; Month = month; LeaseKey = key; }
    public long Id { get; private set; }
    public string Scope { get; private set; } = null!;
    public string Environment { get; private set; } = null!;
    public DateOnly Month { get; private set; }
    public string LeaseKey { get; private set; } = null!;
    public Guid? LeaseId { get; private set; }
    public DateTimeOffset? LeaseUntilUtc { get; private set; }
    public DateTimeOffset? LastStartedAtUtc { get; private set; }
    public DateTimeOffset? LastSuccessAtUtc { get; private set; }
    public string Status { get; private set; } = "Never";
    public string? FailureCode { get; private set; }
    public int ImportedRows { get; private set; }
    public long Revision { get; private set; }
    public Guid Start(DateTimeOffset now)
    { LeaseId = Guid.NewGuid(); LeaseUntilUtc = now.AddMinutes(5); LastStartedAtUtc = now; Status = "Running"; FailureCode = null; Revision++; return LeaseId.Value; }
    public void Finish(DateTimeOffset now, int rows) { Status = "Succeeded"; LastSuccessAtUtc = now; ImportedRows = rows; Release(); }
    public void Fail(string code) { Status = "Failed"; FailureCode = code; Release(); }
    private void Release() { LeaseId = null; LeaseUntilUtc = null; Revision++; }
}
