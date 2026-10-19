namespace Juple.Domain.Support;

/// <summary>
/// What a support inquiry is about. Persisted by name (the stable code the Mobile app also sends); the
/// app localizes the display, so no localized text is ever authoritative.
/// </summary>
public enum SupportInquiryType
{
    Account,
    Subscription,
    LinkSaving,
    CollectionSharing,
    Bug,
    FeatureRequest,
    Other,
}

/// <summary>
/// 접수 (Pending) -> 처리중 (InProgress, set by an admin) -> 답변완료 (Answered). Stored by name, so appending a state never changes
/// what an existing row means. Still no assignment, escalation, closing or SLA states.
/// </summary>
public enum SupportInquiryStatus
{
    Pending,
    Answered,
    InProgress,
}

/// <summary>A status change the inquiry's lifecycle does not allow (for example taking back an answer).</summary>
public sealed class SupportInquiryTransitionException(string message) : Exception(message);

/// <summary>
/// One question a signed-in user sent to Juple support, and (once given) the answer. Owned by the internal
/// <see cref="UserId"/> taken from the authenticated principal - never from a request body. The diagnostic
/// columns hold only app/device facts the Mobile app attaches (no identity, link or Collection data).
/// <see cref="ClientRequestId"/> makes a retried POST return this same row instead of creating another.
/// </summary>
public sealed class SupportInquiry
{
    private SupportInquiry()
    {
    }

    public SupportInquiry(
        long userId,
        Guid clientRequestId,
        SupportInquiryType type,
        string content,
        SupportInquiryDiagnostics diagnostics,
        DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        ClientRequestId = clientRequestId;
        Type = type;
        Content = content;
        Status = SupportInquiryStatus.Pending;
        AppVersion = diagnostics.AppVersion;
        BuildNumber = diagnostics.BuildNumber;
        Platform = diagnostics.Platform;
        OsVersion = diagnostics.OsVersion;
        DeviceModel = diagnostics.DeviceModel;
        Locale = diagnostics.Locale;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid ClientRequestId { get; private set; }

    public SupportInquiryType Type { get; private set; }

    public string Content { get; private set; } = null!;

    public SupportInquiryStatus Status { get; private set; }

    public string? Answer { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? AnsweredAtUtc { get; private set; }

    public string? AppVersion { get; private set; }

    public string? BuildNumber { get; private set; }

    public string? Platform { get; private set; }

    public string? OsVersion { get; private set; }

    public string? DeviceModel { get; private set; }

    public string? Locale { get; private set; }

    /// <summary>The last time support changed this inquiry (status or answer); null while untouched since it was created.</summary>
    public DateTimeOffset? UpdatedAtUtc { get; private set; }

    /// <summary>Records (or replaces) the support answer; the answer time is that of the latest answer.</summary>
    public void RecordAnswer(string answer, DateTimeOffset answeredAtUtc)
    {
        Answer = answer;
        Status = SupportInquiryStatus.Answered;
        AnsweredAtUtc = answeredAtUtc;
        UpdatedAtUtc = answeredAtUtc;
    }

    /// <summary>
    /// Moves an unanswered inquiry between 접수 (Pending) and 처리중 (InProgress). Answered is reached only through
    /// RecordAnswer, and an answered inquiry never goes back (that would hide the answer the user may already have read).
    /// Returns false when the inquiry is already in that state (nothing changed).
    /// </summary>
    public bool ChangeUnansweredStatus(SupportInquiryStatus status, DateTimeOffset changedAtUtc)
    {
        if (status is not (SupportInquiryStatus.Pending or SupportInquiryStatus.InProgress))
        {
            throw new SupportInquiryTransitionException("Only Pending and InProgress can be set directly; Answered is set by an answer.");
        }

        if (Status == SupportInquiryStatus.Answered)
        {
            throw new SupportInquiryTransitionException("An answered inquiry cannot go back to an unanswered state.");
        }

        if (Status == status)
        {
            return false;
        }

        Status = status;
        UpdatedAtUtc = changedAtUtc;
        return true;
    }
}

/// <summary>The only context a support inquiry carries about the app and device. Every value is optional and bounded.</summary>
public sealed record SupportInquiryDiagnostics(
    string? AppVersion,
    string? BuildNumber,
    string? Platform,
    string? OsVersion,
    string? DeviceModel,
    string? Locale);
