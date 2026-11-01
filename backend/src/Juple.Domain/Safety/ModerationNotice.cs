namespace Juple.Domain.Safety;

public enum ModerationNoticeKind : byte
{
    /// <summary>An operator reviewed a report about the recipient's content and decided on a warning. Carries the operator's reviewed words.</summary>
    Warning = 1,

    /// <summary>The result of a report the recipient made - a generic "it was reviewed", never what was done to the other person.</summary>
    ReportResult = 2,
}

/// <summary>
/// A message from the operators to one person (the 이용 안내 / 신고 처리 결과 in their Inbox). The words are written - and reviewed - by the
/// operator before sending, so nothing of the report itself (the reporter, their explanation) is ever copied here. It stays until the
/// recipient's account is deleted; <see cref="AcknowledgedAtUtc"/> records that they opened and confirmed it. One Warning per report and
/// recipient (a unique index), so a repeated click or a second operator can never send it twice.
/// </summary>
public sealed class ModerationNotice
{
    public const int ReasonMaxLength = 500;
    public const int GuidanceMaxLength = 1000;

    private ModerationNotice()
    {
    }

    public ModerationNotice(
        long recipientUserId, ModerationNoticeKind kind, long? reportId, string? reason, string? guidance, long? createdByAdminUserId, DateTimeOffset createdAtUtc)
    {
        RecipientUserId = recipientUserId;
        Kind = kind;
        ReportId = reportId;
        Reason = reason;
        Guidance = guidance;
        CreatedByAdminUserId = createdByAdminUserId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long RecipientUserId { get; private set; }

    public ModerationNoticeKind Kind { get; private set; }

    public long? ReportId { get; private set; }

    /// <summary>What was found, in the operator's words (신고 내용). Null for a result notice.</summary>
    public string? Reason { get; private set; }

    /// <summary>What the operator asks of the person (관리자 안내). Null for a result notice.</summary>
    public string? Guidance { get; private set; }

    public long? CreatedByAdminUserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? AcknowledgedAtUtc { get; private set; }

    public void Acknowledge(DateTimeOffset nowUtc) => AcknowledgedAtUtc ??= nowUtc;
}
