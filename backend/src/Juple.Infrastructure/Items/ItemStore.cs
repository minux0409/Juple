using Juple.Application.Inbox;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class ItemStore(JupleDbContext dbContext) : IInboxEntryStore
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

        var item = new Item(userId, url, clientRequestId, savedAtUtc);
        dbContext.Items.Add(item);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (clientRequestId is not null)
        {
            return await ItemSaveRaceRecovery.RecoverOrRethrowAsync(
                exception,
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception),
                url,
                dbContext.ChangeTracker.Clear,
                lookupCancellationToken => FindByClientRequestIdAsync(
                    userId, clientRequestId.Value, lookupCancellationToken),
                cancellationToken);
        }

        return new InboxEntrySaveResult(
            new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc),
            Created: true);
    }

    public async Task<IReadOnlyList<InboxEntryDto>> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default) =>
        await dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId
                && item.State == ItemState.Inbox
                && item.SavedAtUtc >= fromUtc
                && item.SavedAtUtc < toUtc)
            .OrderByDescending(item => item.SavedAtUtc)
            .ThenByDescending(item => item.Id)
            .Select(item => new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc))
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
        dbContext.Items
            .AsNoTracking()
            .Where(item => item.UserId == userId && item.ClientRequestId == clientRequestId)
            .Select(item => new InboxEntryDto(item.Id, item.Url, item.SavedAtUtc))
            .FirstOrDefaultAsync(cancellationToken);
}
