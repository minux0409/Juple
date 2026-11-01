namespace Juple.Application.Safety;

/// <summary>
/// An operator message the recipient may read: an 이용 안내 (Kind = warning, with the operator's reviewed reason and guidance) or the generic
/// result of their own report (Kind = reportResult, no text). Never carries anything of the report itself.
/// </summary>
public sealed record ModerationNoticeDto(long Id, string Kind, string? Reason, string? Guidance, DateTimeOffset CreatedAtUtc, DateTimeOffset? AcknowledgedAtUtc)
{
    /// <summary>Kind = action only: contentDeleted, contentRestored, shareRestricted, shareRestrictionLifted, accountRestricted, accountRestrictionLifted.</summary>
    public string? ActionType { get; init; }

    /// <summary>The title of the content the notice is about, as it was at that moment - readable even after the content is deleted.</summary>
    public string? ContentTitle { get; init; }

    /// <summary>"Item" (a link) or "Collection".</summary>
    public string? ContentType { get; init; }

    /// <summary>The report's reason code (Spam, Harassment...), for the app to word in the person's language.</summary>
    public string? ReasonCode { get; init; }
}

public interface IModerationNoticeStore
{
    /// <summary>Only the recipient's own notice; anyone else's id is simply not there (null).</summary>
    Task<ModerationNoticeDto?> GetAsync(long userId, long noticeId, CancellationToken cancellationToken = default);

    /// <summary>The recipient's operator messages (warning / action) they have not confirmed yet, oldest first - what the app shows as 운영팀 안내.</summary>
    Task<IReadOnlyList<ModerationNoticeDto>> ListUnacknowledgedAsync(long userId, int limit, CancellationToken cancellationToken = default);

    /// <summary>Records that the recipient opened and confirmed it; repeating it changes nothing. False = not their notice.</summary>
    Task<bool> AcknowledgeAsync(long userId, long noticeId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>True while an operator's use restriction (read-only) is on this person's account.</summary>
    Task<bool> IsUsageRestrictedAsync(long userId, CancellationToken cancellationToken = default);
}
