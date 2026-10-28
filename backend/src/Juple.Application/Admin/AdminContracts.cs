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
    DateTimeOffset? AnsweredAtUtc)
{
    /// <summary>The device locale the inquiry was written with (diagnostics).</summary>
    public string? Locale { get; init; }

    /// <summary>The detected language, once the inquiry has been translated.</summary>
    public string? ContentLanguage { get; init; }
}

public sealed record AdminInquiryPage(IReadOnlyList<AdminInquiryListItem> Items, long? NextCursor);

/// <summary>A Korean machine translation of what the person wrote; Language is the detected language of the original.</summary>
public sealed record AdminInquiryContentTranslation(string? Language, string TextKo, DateTimeOffset TranslatedAtUtc);

/// <summary>The admin's unsent answer: the Korean text, its translation and the language it is for.</summary>
public sealed record AdminInquiryAnswerDraft(string? SourceKo, string? Translated, string? Language, DateTimeOffset SavedAtUtc);

/// <summary>Whether inquiries can be machine-translated: a provider exists (Configured) AND sending user text to it is allowed.</summary>
public sealed record AdminInquiryTranslationState(string Provider, bool Configured, bool Allowed);

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
    IReadOnlyList<AdminAuditEntry> History)
{
    public AdminInquiryContentTranslation? ContentTranslation { get; init; }

    /// <summary>The Korean original of the answer the person received (null for answers sent before this existed).</summary>
    public string? AnswerSourceKo { get; init; }

    /// <summary>The language of Answer as sent (null for answers sent before this existed).</summary>
    public string? AnswerLanguage { get; init; }

    public AdminInquiryAnswerDraft? AnswerDraft { get; init; }

    /// <summary>The language to answer in: the detected language, else the inquiry's device locale, else the account's locale, else ko.</summary>
    public string SuggestedLanguage { get; init; } = "ko";

    public AdminInquiryTranslationState? Translation { get; init; }

    /// <summary>
    /// The inquiry's concurrency token for a send: its last support change, or its creation for an untouched one. The Admin Web
    /// sends it back unchanged; a different current value means someone changed the inquiry since it was loaded.
    /// </summary>
    public DateTimeOffset ChangeToken => UpdatedAtUtc ?? CreatedAtUtc;
}

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
    /// <summary>openOnly = 접수 and 처리중 together (the 미답변 list); ignored when status is given.</summary>
    Task<AdminInquiryPage> ListAsync(Juple.Domain.Support.SupportInquiryStatus? status, long? cursor, int limit, bool openOnly, CancellationToken cancellationToken = default);

    Task<AdminInquiryDetail?> GetAsync(long inquiryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets 접수/처리중 and writes the audit record in ONE save (one transaction). False when the inquiry does not exist.
    /// Throws SupportInquiryTransitionException for an answered inquiry.
    /// </summary>
    Task<bool> ChangeStatusAsync(long inquiryId, Juple.Domain.Support.SupportInquiryStatus status, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Records (or replaces) the answer - status 답변완료 - and the audit record in ONE save. False when it does not exist.</summary>
    Task<bool> AnswerAsync(long inquiryId, string answer, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public enum AdminInquiryAnswerOutcome { NotFound, Changed, Unchanged, Answered }

/// <summary>The translation workflow's writes on the existing inquiry row (AdminSupportInquiryStore implements both interfaces).</summary>
public interface IAdminInquiryWorkflowStore
{
    /// <summary>The person's text, read only to translate it; null when the inquiry does not exist.</summary>
    Task<string?> GetContentAsync(long inquiryId, CancellationToken cancellationToken = default);

    Task<bool> RecordContentTranslationAsync(long inquiryId, string? detectedLanguage, string translationKo, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<bool> SaveDraftAsync(long inquiryId, string? sourceKo, string? translated, string? language, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sends the answer: the delivered text, its Korean source and language, status 답변완료 and the audit record in ONE save -
    /// unless the inquiry changed since expectedUpdatedAtUtc (Changed) or exactly this answer was already sent (Unchanged: nothing written).
    /// </summary>
    Task<AdminInquiryAnswerOutcome> SendAnswerAsync(long inquiryId, string delivered, string sourceKo, string language, DateTimeOffset? expectedUpdatedAtUtc,
        long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
