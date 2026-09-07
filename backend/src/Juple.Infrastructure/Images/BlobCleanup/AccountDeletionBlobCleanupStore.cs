using Juple.Application.Images.BlobCleanup;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Images.BlobCleanup;

public sealed class AccountDeletionBlobCleanupStore(JupleDbContext dbContext) : IAccountDeletionBlobCleanupStore
{
    public Task<PendingBlobCleanupDto?> GetAsync(long id, CancellationToken cancellationToken = default) =>
        dbContext.AccountDeletionBlobCleanups
            .AsNoTracking()
            .Where(cleanup => cleanup.Id == id)
            .Select(cleanup => new PendingBlobCleanupDto(
                cleanup.Id, cleanup.BlobPrefix, cleanup.AttemptCount, cleanup.FinalSweepAfterUtc))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<PendingBlobCleanupDto>> ListPendingAsync(
        CancellationToken cancellationToken = default) =>
        await dbContext.AccountDeletionBlobCleanups
            .AsNoTracking()
            .OrderBy(cleanup => cleanup.CreatedAtUtc)
            .Select(cleanup => new PendingBlobCleanupDto(
                cleanup.Id, cleanup.BlobPrefix, cleanup.AttemptCount, cleanup.FinalSweepAfterUtc))
            .ToListAsync(cancellationToken);

    public async Task RecordFailedAttemptAsync(
        long id, string? errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default)
    {
        var cleanup = await dbContext.AccountDeletionBlobCleanups
            .SingleOrDefaultAsync(row => row.Id == id, cancellationToken);
        if (cleanup is null)
        {
            return;
        }

        cleanup.RecordFailedAttempt(errorCode, attemptedAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task ScheduleFinalSweepAsync(
        long id, DateTimeOffset finalSweepAfterUtc, CancellationToken cancellationToken = default)
    {
        var cleanup = await dbContext.AccountDeletionBlobCleanups
            .SingleOrDefaultAsync(row => row.Id == id, cancellationToken);
        if (cleanup is null)
        {
            return;
        }

        cleanup.ScheduleFinalSweep(finalSweepAfterUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        dbContext.AccountDeletionBlobCleanups
            .Where(cleanup => cleanup.Id == id)
            .ExecuteDeleteAsync(cancellationToken);
}
