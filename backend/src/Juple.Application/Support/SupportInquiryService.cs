using Juple.Domain.Support;

namespace Juple.Application.Support;

public sealed class SupportInquiryService(ISupportInquiryStore store, TimeProvider timeProvider) : ISupportInquiryService
{
    public const int MaxContentLength = 4000;
    public const int MaxAnswerLength = 8000;
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 50;

    private const int MaxVersionLength = 32;
    private const int MaxPlatformLength = 16;
    private const int MaxDeviceModelLength = 100;
    private const int MaxLocaleLength = 35;

    public async Task<SupportInquiryCreateResult> CreateAsync(
        long userId,
        CreateSupportInquiryCommand command,
        CancellationToken cancellationToken = default)
    {
        if (command.ClientRequestId is not { } clientRequestId || clientRequestId == Guid.Empty)
        {
            throw new InvalidSupportInquiryException("clientRequestId", "clientRequestId is required.");
        }

        if (!TryParseType(command.Type, out var type))
        {
            throw new InvalidSupportInquiryException("type", "type must be one of the supported inquiry types.");
        }

        var content = command.Content?.Trim();
        if (string.IsNullOrEmpty(content))
        {
            throw new InvalidSupportInquiryException("content", "content is required.");
        }

        if (content.Length > MaxContentLength)
        {
            throw new InvalidSupportInquiryException("content", $"content must be at most {MaxContentLength} characters.");
        }

        var diagnostics = Normalize(command.Diagnostics);
        var inquiry = new SupportInquiry(userId, clientRequestId, type, content, diagnostics, timeProvider.GetUtcNow());

        var (stored, created) = await store.CreateAsync(inquiry, cancellationToken);
        if (!created && (stored.Type != type || stored.Content != content))
        {
            throw new SupportInquiryClientRequestConflictException();
        }

        return new SupportInquiryCreateResult(ToDto(stored), created);
    }

    public async Task<SupportInquiryPage> ListAsync(long userId, long? cursor, int? limit, CancellationToken cancellationToken = default)
    {
        var pageSize = limit ?? DefaultPageSize;
        if (pageSize is < 1 or > MaxPageSize)
        {
            throw new InvalidSupportInquiryException("limit", $"limit must be between 1 and {MaxPageSize}.");
        }

        if (cursor is <= 0)
        {
            throw new InvalidSupportInquiryException("cursor", "cursor is invalid.");
        }

        // One extra row says whether another page exists.
        var rows = await store.ListAsync(userId, cursor, pageSize + 1, cancellationToken);
        var page = rows.Take(pageSize).Select(ToDto).ToList();
        return new SupportInquiryPage(page, rows.Count > pageSize ? page[^1].InquiryId : null);
    }

    public async Task<SupportInquiryDto> GetAsync(long userId, long inquiryId, CancellationToken cancellationToken = default)
    {
        var inquiry = await store.FindAsync(userId, inquiryId, cancellationToken)
            ?? throw new SupportInquiryNotFoundException();
        return ToDto(inquiry);
    }

    public async Task AnswerAsync(long inquiryId, string? answer, CancellationToken cancellationToken = default)
    {
        var trimmed = answer?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new InvalidSupportInquiryException("answer", "answer is required.");
        }

        if (trimmed.Length > MaxAnswerLength)
        {
            throw new InvalidSupportInquiryException("answer", $"answer must be at most {MaxAnswerLength} characters.");
        }

        if (!await store.AnswerAsync(inquiryId, trimmed, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new SupportInquiryNotFoundException();
        }
    }

    private static bool TryParseType(string? value, out SupportInquiryType type)
    {
        // Exact stable codes only - a number or a differently cased name is not a valid code.
        type = default;
        return value is not null
            && Enum.GetNames<SupportInquiryType>().Contains(value, StringComparer.Ordinal)
            && Enum.TryParse(value, ignoreCase: false, out type);
    }

    private static SupportInquiryDiagnostics Normalize(SupportInquiryDiagnosticsInput? input) =>
        new(
            Bound(input?.AppVersion, MaxVersionLength),
            Bound(input?.BuildNumber, MaxVersionLength),
            Bound(input?.Platform, MaxPlatformLength),
            Bound(input?.OsVersion, MaxVersionLength),
            Bound(input?.DeviceModel, MaxDeviceModelLength),
            Bound(input?.Locale, MaxLocaleLength));

    /// <summary>Trimmed, single-line, cut to the column's size; blank means "not given". Diagnostics never fail a request.</summary>
    private static string? Bound(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = new string(value.Trim().Where(character => !char.IsControl(character)).ToArray());
        if (cleaned.Length == 0)
        {
            return null;
        }

        return cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
    }

    private static SupportInquiryDto ToDto(SupportInquiry inquiry) =>
        new(
            inquiry.Id,
            inquiry.Type.ToString(),
            inquiry.Status.ToString(),
            inquiry.Content,
            inquiry.CreatedAtUtc,
            inquiry.Answer,
            inquiry.AnsweredAtUtc);
}
