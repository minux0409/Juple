namespace Juple.Domain.Safety;

public enum ModerationNoticeKind : byte
{
    /// <summary>An operator reviewed a report about the recipient's content and decided on a warning. Carries the operator's reviewed words.</summary>
    Warning = 1,

    /// <summary>The result of a report the recipient made - a generic "it was reviewed", never what was done to the other person.</summary>
    ReportResult = 2,

    /// <summary>
    /// An operator ACTION that changed something of the recipient's (a link or Collection deleted / restored, its sharing restricted / lifted,
    /// the account's use restricted / lifted). Created by the action itself, in its transaction - not by a separate "send a warning" step.
    /// </summary>
    Action = 3,
}

public enum ModerationActionType : byte
{
    ContentDeleted = 1,
    ContentRestored = 2,
    ShareRestricted = 3,
    ShareRestrictionLifted = 4,
    AccountRestricted = 5,
    AccountRestrictionLifted = 6,
}

/// <summary>
/// A message from the operators to one person (the 운영팀 안내 / 신고 처리 결과 in their Inbox). It is a snapshot: what was done, to what (title and
/// type, as they were at that moment), the reason code and the operator's reviewed words - so it stays readable after the content is soft-deleted or
/// gone. The words are written - and reviewed - by the operator before sending, so nothing of the report itself (the reporter, their explanation)
/// is ever copied here. It stays until the recipient's account is deleted; <see cref="AcknowledgedAtUtc"/> records that they confirmed it (reading
/// again never needs it to be unconfirmed). A Warning / ReportResult is unique per report and recipient; an Action carries a DedupKey so the same
/// action is never noticed twice.
/// </summary>
public sealed class ModerationNotice
{
    public const int ReasonMaxLength = 500;
    public const int GuidanceMaxLength = 1000;
    public const int ContentTitleMaxLength = 300;

    private ModerationNotice()
    {
    }

    public ModerationNotice(
        long recipientUserId, ModerationNoticeKind kind, long? reportId, string? reason, string? guidance, long? createdByAdminUserId, DateTimeOffset createdAtUtc,
        ModerationActionType? actionType = null, string? contentTitle = null, string? contentType = null, string? reasonCode = null, string? dedupKey = null)
    {
        RecipientUserId = recipientUserId;
        Kind = kind;
        ReportId = reportId;
        Reason = reason;
        Guidance = guidance;
        CreatedByAdminUserId = createdByAdminUserId;
        CreatedAtUtc = createdAtUtc;
        ActionType = actionType;
        ContentTitle = contentTitle is { Length: > ContentTitleMaxLength } ? contentTitle[..ContentTitleMaxLength] : contentTitle;
        ContentType = contentType;
        ReasonCode = reasonCode;
        DedupKey = dedupKey;
    }

    public long Id { get; private set; }

    public long RecipientUserId { get; private set; }

    public ModerationNoticeKind Kind { get; private set; }

    public long? ReportId { get; private set; }

    /// <summary>What was found, in the operator's words (신고 내용). Null for a result notice and for an action that needs no free text.</summary>
    public string? Reason { get; private set; }

    /// <summary>What the operator asks of the person (관리자 안내) - the message the operator reviewed for the person. Null for a result notice.</summary>
    public string? Guidance { get; private set; }

    public long? CreatedByAdminUserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? AcknowledgedAtUtc { get; private set; }

    /// <summary>Action only: what was done.</summary>
    public ModerationActionType? ActionType { get; private set; }

    /// <summary>The title of the content the notice is about, as it was when the notice was made ("Item" link or "Collection").</summary>
    public string? ContentTitle { get; private set; }

    public string? ContentType { get; private set; }

    /// <summary>The report's reason code (Spam, Harassment...): the app words it in the person's language. Never the reporter's text.</summary>
    public string? ReasonCode { get; private set; }

    public string? DedupKey { get; private set; }

    public void Acknowledge(DateTimeOffset nowUtc) => AcknowledgedAtUtc ??= nowUtc;
}
