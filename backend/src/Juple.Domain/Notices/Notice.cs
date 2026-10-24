namespace Juple.Domain.Notices;

[Flags]
public enum NoticePlatforms { Web = 1, Android = 2, Ios = 4, All = Web | Android | Ios }
public enum NoticeStatus { Draft, Published }

public sealed class Notice
{
    public long Id { get; private set; }
    public NoticeStatus Status { get; set; }
    public bool IsImportant { get; set; }
    public bool IsPinned { get; set; }
    public NoticePlatforms Platforms { get; set; } = NoticePlatforms.All;
    public DateTimeOffset StartsAtUtc { get; set; }
    public DateTimeOffset? EndsAtUtc { get; set; }
    public string? OfficialUrl { get; set; }
    public int ReadVersion { get; set; } = 1;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public DateTimeOffset? DeletedAtUtc { get; set; }
    public byte[] Version { get; private set; } = [];
    public List<NoticeTranslation> Translations { get; private set; } = [];
}
public sealed class NoticeTranslation
{
    public long NoticeId { get; set; }
    public string Language { get; set; } = "ko";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
}
public sealed class NoticeRead
{
    public long NoticeId { get; set; }
    public long UserId { get; set; }
    public int ReadVersion { get; set; }
    public DateTimeOffset ReadAtUtc { get; set; }
}
