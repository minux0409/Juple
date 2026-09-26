using Juple.Application.Items.InstagramMetadataRetry;
using Juple.Domain.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Items;

public sealed class InstagramMetadataRetryStore(JupleDbContext dbContext) : IInstagramMetadataRetryStore
{
    public async Task RegisterNewCandidatesAsync(
        DateTimeOffset now,
        TimeSpan discoveryWindow,
        TimeSpan firstAttemptDelay,
        CancellationToken cancellationToken = default)
    {
        var earliestSavedAtUtc = now - discoveryWindow;
        var latestSavedAtUtc = now - firstAttemptDelay;

        // The Url.Contains check is a coarse, index-friendly pre-filter only (translates to a SQL
        // LIKE) - InstagramMetadataNormalizer.IsInstagramHost below re-checks the actual parsed
        // host precisely, the same two-phase approach already used elsewhere in this codebase for
        // Instagram host detection.
        var candidates = await dbContext.Items
            .AsNoTracking()
            .Where(item => item.SavedAtUtc >= earliestSavedAtUtc && item.SavedAtUtc <= latestSavedAtUtc)
            .Where(item => item.Title == null || item.PreviewImageUrl == null)
            .Where(item => item.Url.Contains("instagram.com"))
            .Where(item => !dbContext.InstagramMetadataRetryTasks.Any(task => task.ItemId == item.Id))
            .Select(item => new { item.Id, item.Url })
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates)
        {
            if (!IsEligibleInstagramCandidateUrl(candidate.Url))
            {
                continue;
            }

            dbContext.InstagramMetadataRetryTasks.Add(new InstagramMetadataRetryTask(candidate.Id, now, now));

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception)
                when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent worker run already registered this Item - nothing more to do.
                dbContext.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>The precise host check behind the SQL Url.Contains pre-filter above - never a
    /// YouTube or other non-Instagram URL, no matter what the coarse SQL LIKE matched (e.g. a URL
    /// that merely contains "instagram.com" somewhere in its query string). Internal so a unit test
    /// can exercise this exact predicate without a real database.</summary>
    internal static bool IsEligibleInstagramCandidateUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && InstagramMetadataNormalizer.IsInstagramHost(uri.Host);

    public async Task<IReadOnlyList<DueInstagramMetadataRetryTaskDto>> ListDueAsync(
        DateTimeOffset now, CancellationToken cancellationToken = default) =>
        await (
            from task in dbContext.InstagramMetadataRetryTasks.AsNoTracking()
            join item in dbContext.Items.AsNoTracking() on task.ItemId equals item.Id
            where task.NextAttemptAtUtc <= now
            orderby task.NextAttemptAtUtc
            select new DueInstagramMetadataRetryTaskDto(task.Id, task.ItemId, item.Url, task.AttemptCount)
        ).ToListAsync(cancellationToken);

    public async Task<bool> TryClaimAsync(
        long taskId,
        DateTimeOffset claimedAtUtc,
        DateTimeOffset staleClaimBeforeUtc,
        CancellationToken cancellationToken = default)
    {
        var affected = await dbContext.InstagramMetadataRetryTasks
            .Where(task => task.Id == taskId
                && (task.ClaimedAtUtc == null || task.ClaimedAtUtc < staleClaimBeforeUtc))
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(task => task.ClaimedAtUtc, claimedAtUtc), cancellationToken);
        return affected == 1;
    }

    public async Task<(string? Title, string? PreviewImageUrl)?> GetItemMetadataStateAsync(
        long itemId, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.Items
            .AsNoTracking()
            .Where(item => item.Id == itemId)
            .Select(item => new { item.Title, item.PreviewImageUrl })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : (row.Title, row.PreviewImageUrl);
    }

    public async Task ApplyResolvedMetadataAsync(
        long itemId, string? title, string? previewImageUrl, CancellationToken cancellationToken = default)
    {
        var item = await dbContext.Items.SingleOrDefaultAsync(item => item.Id == itemId, cancellationToken);
        if (item is null)
        {
            return;
        }

        // Only ever fills a field that is still null right now - never overwrites a user edit or
        // the client's own concurrent enrichment success, no matter how close the timing (the same
        // Item.ApplyAutomaticMetadata rule the device-fetched Instagram candidate path uses).
        item.ApplyAutomaticMetadata(title, previewImageUrl);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent user edit (or the client's own concurrent enrichment success) landed
            // between the read above and this write - that edit wins; retrying with the now-stale
            // in-memory values here would risk clobbering it, so this attempt simply contributes
            // nothing instead.
        }
    }

    public Task DeleteAsync(long taskId, CancellationToken cancellationToken = default) =>
        dbContext.InstagramMetadataRetryTasks
            .Where(task => task.Id == taskId)
            .ExecuteDeleteAsync(cancellationToken);

    public async Task RecordFailedAttemptAsync(
        long taskId,
        DateTimeOffset attemptedAtUtc,
        string? errorCode,
        DateTimeOffset nextAttemptAtUtc,
        CancellationToken cancellationToken = default)
    {
        var task = await dbContext.InstagramMetadataRetryTasks
            .SingleOrDefaultAsync(task => task.Id == taskId, cancellationToken);
        if (task is null)
        {
            return;
        }

        task.RecordFailedAttempt(attemptedAtUtc, errorCode, nextAttemptAtUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkExhaustedAsync(
        long taskId, DateTimeOffset attemptedAtUtc, string? errorCode, CancellationToken cancellationToken = default)
    {
        var task = await dbContext.InstagramMetadataRetryTasks
            .SingleOrDefaultAsync(task => task.Id == taskId, cancellationToken);
        if (task is null)
        {
            return;
        }

        task.MarkExhausted(attemptedAtUtc, errorCode);
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
