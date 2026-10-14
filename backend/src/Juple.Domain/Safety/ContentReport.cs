namespace Juple.Domain.Safety;

/// <summary>What a report is about. Persisted by name (the stable code both apps send).</summary>
public enum ReportTargetType
{
    User,
    Collection,
    Item,
    Comment,
}

/// <summary>Why it was reported - the one list the Mobile app and the Web both show (the apps localize the words).</summary>
public enum ReportReason
{
    Spam,
    Harassment,
    HateOrAbuse,
    SexualOrInappropriate,
    Illegal,
    ScamOrMaliciousLink,
    IntellectualProperty,
    Other,
}

/// <summary>Deliberately small: Pending until a person at Juple has looked; then reviewed, dismissed (nothing wrong) or actioned (something was done).</summary>
public enum ReportStatus
{
    Pending,
    Reviewed,
    Dismissed,
    Actioned,
}

/// <summary>
/// One report of a user, a Collection, a link or a comment by a signed-in user. The reporter is the internal user id taken from the
/// authenticated principal (never from a request). <see cref="TargetId"/> is the internal id of the reported thing (a user id for
/// <see cref="ReportTargetType.User"/>); <see cref="TargetUserId"/> is the person responsible for it (its owner / author) when there is one;
/// <see cref="CollectionId"/> is the Collection through which the reporter could see an Item or a Comment. Reports are moderation evidence:
/// when the reporter's account is deleted <see cref="ReporterUserId"/> is cleared (the report itself stays - see docs/ugc-moderation.md).
/// </summary>
public sealed class ContentReport
{
    public const int DetailsMaxLength = 1000;
    public const int ResolutionMaxLength = 1000;

    private ContentReport()
    {
    }

    public ContentReport(
        long reporterUserId,
        ReportTargetType targetType,
        long targetId,
        long? targetUserId,
        long? collectionId,
        ReportReason reason,
        string? details,
        DateTimeOffset createdAtUtc)
    {
        ReporterUserId = reporterUserId;
        TargetType = targetType;
        TargetId = targetId;
        TargetUserId = targetUserId;
        CollectionId = collectionId;
        Reason = reason;
        Details = details;
        Status = ReportStatus.Pending;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    /// <summary>Null once the reporter's account was deleted.</summary>
    public long? ReporterUserId { get; private set; }

    public ReportTargetType TargetType { get; private set; }

    public long TargetId { get; private set; }

    public long? TargetUserId { get; private set; }

    public long? CollectionId { get; private set; }

    public ReportReason Reason { get; private set; }

    public string? Details { get; private set; }

    public ReportStatus Status { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? ReviewedAtUtc { get; private set; }

    public string? Resolution { get; private set; }
}
