using Juple.Domain.Admin;

namespace Juple.Application.Admin;

/// <summary>An active admin grant as the authorization policy sees it.</summary>
public sealed record AdminAccess(long UserId, AdminRole Role);

/// <summary>The one lookup the Admin policy runs: the ACTIVE grant of an internal Juple user, or null.</summary>
public interface IAdminAccessStore
{
    Task<AdminAccess?> FindActiveAsync(long userId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The dashboard's numbers, computed live with SQL aggregates (COUNT/EXISTS - nothing is loaded into memory). The contract is
/// what the Admin Web shows, so it can later be served from a daily aggregate table without changing the client.
/// </summary>
/// <param name="TodayStartUtc">The start of "today" the counts used (the admin's own midnight, sent by the Admin Web).</param>
/// <param name="TotalUsers">Juple accounts that exist (a deleted account is removed, so it is never counted).</param>
/// <param name="NewUsersToday">Accounts created since TodayStartUtc.</param>
/// <param name="NewUsersLast7Days">Accounts created in the 7 days ending today (TodayStartUtc - 6 days onward).</param>
/// <param name="TotalLinks">Saved links not in the trash.</param>
/// <param name="LinksSavedToday">Links saved since TodayStartUtc (including ones already moved to the trash).</param>
/// <param name="TotalCollections">Collections that are not deleted.</param>
/// <param name="SharedCollections">Not-deleted Collections with at least one member or an active share link.</param>
/// <param name="OpenInquiries">Support inquiries not answered yet (접수 + 처리중).</param>
public sealed record AdminDashboardSummary(
    DateTimeOffset TodayStartUtc,
    DateTimeOffset GeneratedAtUtc,
    int TotalUsers,
    int NewUsersToday,
    int NewUsersLast7Days,
    int TotalLinks,
    int LinksSavedToday,
    int TotalCollections,
    int SharedCollections,
    int OpenInquiries);

public interface IAdminDashboardStore
{
    Task<AdminDashboardSummary> GetSummaryAsync(DateTimeOffset todayStartUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

/// <summary>A person as the Admin Web lists them: identifiers and counts only - no email (Juple stores none), no tokens.</summary>
public sealed record AdminUserListItem(
    long UserId,
    string JupleId,
    string? DisplayName,
    DateTimeOffset CreatedAtUtc,
    string PreferredLocale,
    bool TermsAccepted,
    int LinkCount,
    int CollectionCount);

public sealed record AdminUserPage(IReadOnlyList<AdminUserListItem> Items, long? NextCursor);

public interface IAdminUserDirectoryStore
{
    /// <summary>Newest accounts first, keyset-paged by id; an exact Juple ID narrows it to that one person.</summary>
    Task<AdminUserPage> ListAsync(string? exactJupleId, long? cursor, int limit, CancellationToken cancellationToken = default);
}

public sealed record AdminInquiryPerson(long UserId, string JupleId, string? DisplayName);

public sealed record AdminInquiryListItem(
    long InquiryId,
    string Status,
    string Type,
    AdminInquiryPerson? User,
    string ContentPreview,
    string? Platform,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? UpdatedAtUtc,
    DateTimeOffset? AnsweredAtUtc);

public sealed record AdminInquiryPage(IReadOnlyList<AdminInquiryListItem> Items, long? NextCursor);

/// <summary>What the person sent from the app when they wrote the inquiry (the existing diagnostics; nothing new is collected).</summary>
public sealed record AdminInquiryDiagnostics(
    string? AppVersion,
    string? BuildNumber,
    string? Platform,
    string? OsVersion,
    string? DeviceModel,
    string? Locale);

public sealed record AdminAuditEntry(long AdminUserId, string? AdminJupleId, string Action, string? Detail, DateTimeOffset CreatedAtUtc);

public sealed record AdminInquiryDetail(
    long InquiryId,
    string Status,
    string Type,
    AdminInquiryPerson? User,
    string Content,
    string? Answer,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? UpdatedAtUtc,
    DateTimeOffset? AnsweredAtUtc,
    AdminInquiryDiagnostics Diagnostics,
    IReadOnlyList<AdminAuditEntry> History);

/// <summary>The inquiry does not exist.</summary>
public sealed class AdminInquiryNotFoundException : Exception;

/// <summary>The account does not exist (or was deleted).</summary>
public sealed class AdminUserNotFoundException : Exception;

/// <summary>A request the admin endpoints refuse (bad status, empty or oversized answer, a transition the lifecycle forbids).</summary>
public sealed class InvalidAdminRequestException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

public interface IAdminSupportInquiryStore
{
    Task<AdminInquiryPage> ListAsync(Juple.Domain.Support.SupportInquiryStatus? status, long? cursor, int limit, CancellationToken cancellationToken = default);

    Task<AdminInquiryDetail?> GetAsync(long inquiryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets 접수/처리중 and writes the audit record in ONE save (one transaction). False when the inquiry does not exist.
    /// Throws SupportInquiryTransitionException for an answered inquiry.
    /// </summary>
    Task<bool> ChangeStatusAsync(long inquiryId, Juple.Domain.Support.SupportInquiryStatus status, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Records (or replaces) the answer - status 답변완료 - and the audit record in ONE save. False when it does not exist.</summary>
    Task<bool> AnswerAsync(long inquiryId, string answer, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
