using Juple.Application.Safety;
using Juple.Domain.Safety;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Safety;

public sealed class ModerationNoticeStore(JupleDbContext dbContext) : IModerationNoticeStore
{
    public async Task<ModerationNoticeDto?> GetAsync(long userId, long noticeId, CancellationToken cancellationToken = default)
    {
        var notice = await dbContext.ModerationNotices.AsNoTracking()
            .Where(candidate => candidate.Id == noticeId && candidate.RecipientUserId == userId)
            .FirstOrDefaultAsync(cancellationToken);
        return notice is null ? null : ToDto(notice);
    }

    public async Task<IReadOnlyList<ModerationNoticeDto>> ListUnacknowledgedAsync(long userId, int limit, CancellationToken cancellationToken = default)
    {
        var notices = await dbContext.ModerationNotices.AsNoTracking()
            .Where(candidate => candidate.RecipientUserId == userId && candidate.AcknowledgedAtUtc == null
                && (candidate.Kind == ModerationNoticeKind.Warning || candidate.Kind == ModerationNoticeKind.Action))
            .OrderBy(candidate => candidate.Id)
            .Take(Math.Clamp(limit, 1, 20))
            .ToListAsync(cancellationToken);
        return notices.Select(ToDto).ToList();
    }

    private static ModerationNoticeDto ToDto(ModerationNotice notice) =>
        new(
            notice.Id,
            notice.Kind switch { ModerationNoticeKind.Warning => "warning", ModerationNoticeKind.Action => "action", _ => "reportResult" },
            notice.Reason,
            notice.Guidance,
            notice.CreatedAtUtc,
            notice.AcknowledgedAtUtc)
        {
            ActionType = notice.ActionType switch
            {
                ModerationActionType.ContentDeleted => "contentDeleted",
                ModerationActionType.ContentRestored => "contentRestored",
                ModerationActionType.ShareRestricted => "shareRestricted",
                ModerationActionType.ShareRestrictionLifted => "shareRestrictionLifted",
                ModerationActionType.AccountRestricted => "accountRestricted",
                ModerationActionType.AccountRestrictionLifted => "accountRestrictionLifted",
                _ => null,
            },
            ContentTitle = notice.ContentTitle,
            ContentType = notice.ContentType,
            ReasonCode = notice.ReasonCode,
        };

    public async Task<bool> AcknowledgeAsync(long userId, long noticeId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var notice = await dbContext.ModerationNotices.FirstOrDefaultAsync(
            candidate => candidate.Id == noticeId && candidate.RecipientUserId == userId, cancellationToken);
        if (notice is null)
        {
            return false;
        }

        if (notice.AcknowledgedAtUtc is null)
        {
            notice.Acknowledge(nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        // Confirming also reads its Inbox row (the bell count); the message itself stays readable - nothing is deleted by confirming.
        await dbContext.Notifications
            .Where(row => row.UserId == userId && row.SubjectId == noticeId && row.ReadAtUtc == null
                && (row.Type == Juple.Domain.Notifications.NotificationType.AdminWarning || row.Type == Juple.Domain.Notifications.NotificationType.ReportResultNotice))
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.ReadAtUtc, nowUtc), cancellationToken);
        return true;
    }

    public Task<bool> IsUsageRestrictedAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == userId && user.UsageRestrictedAtUtc != null, cancellationToken);
}
