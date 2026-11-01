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
        return notice is null
            ? null
            : new ModerationNoticeDto(
                notice.Id,
                notice.Kind == ModerationNoticeKind.Warning ? "warning" : "reportResult",
                notice.Reason,
                notice.Guidance,
                notice.CreatedAtUtc,
                notice.AcknowledgedAtUtc);
    }

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

        return true;
    }

    public Task<bool> IsUsageRestrictedAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == userId && user.UsageRestrictedAtUtc != null, cancellationToken);
}
