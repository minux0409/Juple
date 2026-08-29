using Juple.Application.Inbox;
using Juple.Domain.Inbox;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Inbox;

public sealed class InboxEntryStore(JupleDbContext dbContext) : IInboxEntryStore
{
    public async Task<InboxEntryDto> SaveAsync(
        long userId,
        string url,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var entry = new InboxEntry(userId, url, savedAtUtc);
        dbContext.InboxEntries.Add(entry);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new InboxEntryDto(entry.Id, entry.Url, entry.SavedAtUtc);
    }

    public async Task<IReadOnlyList<InboxEntryDto>> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default) =>
        await dbContext.InboxEntries
            .AsNoTracking()
            .Where(entry => entry.UserId == userId
                && entry.SavedAtUtc >= fromUtc
                && entry.SavedAtUtc < toUtc)
            .OrderByDescending(entry => entry.SavedAtUtc)
            .ThenByDescending(entry => entry.Id)
            .Select(entry => new InboxEntryDto(entry.Id, entry.Url, entry.SavedAtUtc))
            .ToListAsync(cancellationToken);
}