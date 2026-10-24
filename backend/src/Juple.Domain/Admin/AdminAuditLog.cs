namespace Juple.Domain.Admin;

/// <summary>
/// One record of an admin changing data, written in the SAME transaction as the change itself (so neither can exist without
/// the other). Append-only. Deliberately small: who (the admin's internal UserId), what (an action name), on what (a target type
/// and id) and when - plus a short, purpose-built detail (for example the status transition), never a serialized user object,
/// the answer text, a token or any personal data. No foreign keys: the record outlives the admin's or the target's deletion.
/// </summary>
public sealed class AdminAuditLog
{
    public const int MaxActionLength = 64;
    public const int MaxTargetTypeLength = 32;
    public const int MaxTargetIdLength = 64;
    public const int MaxDetailLength = 512;

    private AdminAuditLog()
    {
    }

    public AdminAuditLog(long adminUserId, string action, string targetType, string targetId, string? detail, DateTimeOffset createdAtUtc)
    {
        AdminUserId = adminUserId;
        Action = action;
        TargetType = targetType;
        TargetId = targetId;
        Detail = detail;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    /// <summary>The acting admin's internal Juple UserId.</summary>
    public long AdminUserId { get; private set; }

    public string Action { get; private set; } = null!;

    public string TargetType { get; private set; } = null!;

    public string TargetId { get; private set; } = null!;

    /// <summary>A short structured note such as "Pending->InProgress"; never personal data or free text written by a user.</summary>
    public string? Detail { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}

/// <summary>The audited admin actions. Names are stored, so they are a stable contract.</summary>
public static class AdminAuditActions
{
    public const string NoticeCreated = "notice.created";
    public const string NoticeUpdated = "notice.updated";
    public const string NoticeDeleted = "notice.deleted";
    public const string SupportInquiryStatusChanged = "support.inquiry.status_changed";
    public const string SupportInquiryAnswered = "support.inquiry.answered";
}

public static class AdminAuditTargets
{
    public const string Notice = "Notice";
    public const string SupportInquiry = "SupportInquiry";
}
