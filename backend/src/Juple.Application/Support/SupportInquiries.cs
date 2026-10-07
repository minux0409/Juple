using Juple.Domain.Support;

namespace Juple.Application.Support;

/// <summary>What a person sees of an inquiry: no internal user id, no diagnostics (those stay server-side).</summary>
public sealed record SupportInquiryDto(
    long InquiryId,
    string Type,
    string Status,
    string Content,
    DateTimeOffset CreatedAtUtc,
    string? Answer,
    DateTimeOffset? AnsweredAtUtc);

/// <summary>A newest-first page; NextCursor is the last row's id (keyset - no OFFSET), null at the end.</summary>
public sealed record SupportInquiryPage(IReadOnlyList<SupportInquiryDto> Items, long? NextCursor);

/// <summary>The unvalidated create request as the API received it - the service validates every part.</summary>
public sealed record CreateSupportInquiryCommand(
    Guid? ClientRequestId,
    string? Type,
    string? Content,
    SupportInquiryDiagnosticsInput? Diagnostics);

public sealed record SupportInquiryDiagnosticsInput(
    string? AppVersion,
    string? BuildNumber,
    string? Platform,
    string? OsVersion,
    string? DeviceModel,
    string? Locale);

public sealed record SupportInquiryCreateResult(SupportInquiryDto Inquiry, bool Created);

public sealed class InvalidSupportInquiryException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

/// <summary>The inquiry does not exist or is not the caller's - one and the same answer, so ids reveal nothing.</summary>
public sealed class SupportInquiryNotFoundException : Exception;

/// <summary>The same ClientRequestId was reused for a different question.</summary>
public sealed class SupportInquiryClientRequestConflictException : Exception;

public interface ISupportInquiryStore
{
    /// <summary>
    /// Inserts the inquiry unless one with the same (userId, clientRequestId) already exists, in which case that
    /// one is returned (also when a concurrent request wins the insert race).
    /// </summary>
    Task<(SupportInquiry Inquiry, bool Created)> CreateAsync(SupportInquiry inquiry, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SupportInquiry>> ListAsync(long userId, long? cursor, int limit, CancellationToken cancellationToken = default);

    Task<SupportInquiry?> FindAsync(long userId, long inquiryId, CancellationToken cancellationToken = default);

    /// <summary>Applies an answer to any user's inquiry (support-side only; never reachable from a user endpoint). False when it does not exist.</summary>
    Task<bool> AnswerAsync(long inquiryId, string answer, DateTimeOffset answeredAtUtc, CancellationToken cancellationToken = default);
}

public interface ISupportInquiryService
{
    Task<SupportInquiryCreateResult> CreateAsync(long userId, CreateSupportInquiryCommand command, CancellationToken cancellationToken = default);

    Task<SupportInquiryPage> ListAsync(long userId, long? cursor, int? limit, CancellationToken cancellationToken = default);

    Task<SupportInquiryDto> GetAsync(long userId, long inquiryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the support answer. An internal application operation only: no HTTP route calls it, because no secure
    /// admin/operator authorization exists to protect one (see SupportInquiriesController).
    /// </summary>
    Task AnswerAsync(long inquiryId, string? answer, CancellationToken cancellationToken = default);
}
