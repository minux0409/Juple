namespace Juple.Application.Admin;

public sealed class AdminWorkspaceOptions
{
    // Requires the separately reviewed AdminWorkspace migration. No writes/queries against new tables while OFF.
    public bool Enabled { get; set; }
    public bool TelemetryEnabled { get; set; }
    public string? TelemetryWorkspaceId { get; set; }
    public string? TelemetryRoleName { get; set; }
}

public sealed record AdminDateRange(DateOnly From, DateOnly Through)
{
    public const int MaxDays = 366;
    public static DateOnly SeoulDate(DateTimeOffset value) => DateOnly.FromDateTime(value.ToOffset(TimeSpan.FromHours(9)).DateTime);
    public DateTimeOffset StartUtc => new DateTimeOffset(From.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(9)).ToUniversalTime();
    public DateTimeOffset EndExclusiveUtc => new DateTimeOffset(Through.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(9)).ToUniversalTime();
    public int Days => Through.DayNumber - From.DayNumber + 1;
    public static AdminDateRange Resolve(string? range, DateOnly? from, DateOnly? through, DateTimeOffset now)
    {
        var today = SeoulDate(now);
        if (from.HasValue != through.HasValue) throw new InvalidAdminRequestException("period", "Both dates are required.");
        if (from is { } start && through is { } end)
        {
            if (start.Year < 2000 || end > today || start > end || end.DayNumber - start.DayNumber >= MaxDays)
                throw new InvalidAdminRequestException("period", "Choose past/current Seoul dates covering at most 366 days.");
            return new(start, end);
        }
        var days = (range ?? "7d") switch { "today" => 1, "7d" => 7, "30d" => 30, "90d" => 90,
            _ => throw new InvalidAdminRequestException("range", "Choose today, 7d, 30d, 90d or explicit dates.") };
        return new(today.AddDays(1 - days), today);
    }
}

public sealed record WorkspaceDay(DateOnly Date, int Signups, int SurvivingAccountsToDate, int LinksSaved,
    int LinkSavers, int SurvivingSavedLinksToDate, int CollectionsCreated, int? ActiveUsers,
    int SharedLinkAddEvents = 0, int ShareEvents = 0, int CommentEvents = 0);
public sealed record WorkspacePlatform(string Platform, int ActiveUsers);
public sealed record WorkspaceRecentUser(string JupleId, DateTimeOffset LastSeenAtUtc);
public sealed record WorkspaceDomain(string Domain, int Links);
public sealed record WorkspacePushDay(DateOnly Date, string Platform, string Status, int Deliveries, double? AverageCreationToAttemptMs);
public sealed record WorkspaceEvent(DateTimeOffset AtUtc, string Kind, string Status, int Attempts);
public sealed record WorkspaceCoverage(string Metric, bool Available, string Explanation);
public sealed record WorkspaceOverview(AdminDateRange Period, string TimeZone, DateTimeOffset GeneratedAtUtc,
    int TotalUsers, int NewUsers, int LiveLinks, int SavedLinks, int UniqueSavers,
    int? ActiveUsers, int? Dau, int? Wau, int? Mau, DateOnly? ActivityTrackingSince,
    IReadOnlyList<WorkspaceDay> Series, IReadOnlyList<WorkspacePlatform> Platforms,
    IReadOnlyList<WorkspaceRecentUser> RecentUsers, IReadOnlyList<WorkspaceDomain> Domains,
    IReadOnlyList<WorkspaceCoverage> Coverage)
{
    public int CurrentCollections { get; init; }
    public int SharedCollections { get; init; }
    public int OpenInquiries { get; init; }
}
public sealed record WorkspaceOperations(AdminDateRange Period, IReadOnlyList<WorkspacePushDay> Push,
    IReadOnlyList<WorkspaceEvent> Events, IReadOnlyList<WorkspaceCoverage> Coverage)
{
    public WorkspaceTelemetry? Telemetry { get; init; }
}
public sealed record WorkspaceHttpDay(DateOnly Date, long Requests, long Errors5xx, long Unauthorized);
public sealed record WorkspaceTelemetry(bool Available, string Status, IReadOnlyList<WorkspaceHttpDay> Days);
public interface IAdminTelemetrySource { Task<WorkspaceTelemetry> ReadAsync(AdminDateRange period, CancellationToken ct); }
public sealed record WorkspacePurchaseState(string Platform, string State, int Purchases);
public sealed record WorkspaceRevenue(bool BillingProgramEnabled, IReadOnlyList<WorkspacePurchaseState> CurrentPurchaseStates,
    bool AmountsAvailable, string Explanation);

public interface IAdminWorkspaceStore
{
    Task<WorkspaceOverview> OverviewAsync(AdminDateRange period, DateTimeOffset now, CancellationToken ct);
    Task<WorkspaceOperations> OperationsAsync(AdminDateRange period, CancellationToken ct);
    Task<WorkspaceRevenue> RevenueAsync(bool billingEnabled, CancellationToken ct);
}
