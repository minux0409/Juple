using Juple.Application.Inbox;
using Juple.Domain.Inbox;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Inbox;

public sealed class InboxEntryStore(JupleDbContext dbContext) : IInboxEntryStore
{
    public async Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        string url,
        Guid? clientRequestId,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default)
    {
        if (clientRequestId is { } requestId)
        {
            var existing = await FindByClientRequestIdAsync(userId, requestId, cancellationToken);
            if (existing is not null)
            {
                return BuildReplayResult(existing, url);
            }
        }

        var entry = new InboxEntry(userId, url, clientRequestId, savedAtUtc);
        dbContext.InboxEntries.Add(entry);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (clientRequestId is not null)
        {
            return await InboxEntrySaveRaceRecovery.RecoverOrRethrowAsync(
                exception,
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception),
                url,
                dbContext.ChangeTracker.Clear,
                lookupCancellationToken => FindByClientRequestIdAsync(
                    userId, clientRequestId.Value, lookupCancellationToken),
                cancellationToken);
        }

        return new InboxEntrySaveResult(
            new InboxEntryDto(entry.Id, entry.Url, entry.SavedAtUtc),
            Created: true);
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

    private static InboxEntrySaveResult BuildReplayResult(InboxEntryDto existing, string requestedUrl)
    {
        if (existing.Url != requestedUrl)
        {
            throw new InboxEntryClientRequestConflictException();
        }

        return new InboxEntrySaveResult(existing, Created: false);
    }

    private Task<InboxEntryDto?> FindByClientRequestIdAsync(
        long userId,
        Guid clientRequestId,
        CancellationToken cancellationToken) =>
        dbContext.InboxEntries
            .AsNoTracking()
            .Where(entry => entry.UserId == userId && entry.ClientRequestId == clientRequestId)
            .Select(entry => new InboxEntryDto(entry.Id, entry.Url, entry.SavedAtUtc))
            .FirstOrDefaultAsync(cancellationToken);
}
