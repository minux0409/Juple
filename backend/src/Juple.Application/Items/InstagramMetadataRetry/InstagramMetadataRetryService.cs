using Juple.Application.UrlMetadata;

namespace Juple.Application.Items.InstagramMetadataRetry;

public sealed class InstagramMetadataRetryService(
    IInstagramMetadataRetryStore store,
    IUrlMetadataResolver urlMetadataResolver,
    TimeProvider timeProvider) : IInstagramMetadataRetryService
{
    // How far back discovery looks for newly eligible Items - see
    // IInstagramMetadataRetryStore.RegisterNewCandidatesAsync's own remarks on why this is a
    // permanent cutoff, not a one-time backfill window.
    internal static readonly TimeSpan DiscoveryWindow = TimeSpan.FromMinutes(30);

    // Gives the client's own synchronous best-effort attempt (see
    // enrichItemTitleFromUrlMetadata/enrichItemPreviewImageFromUrlMetadata in the Mobile app) time
    // to finish before this backstop ever looks at the Item - that call is a normal network
    // round-trip, not a long-running task, so 1 minute is a comfortable margin, not a tight race.
    internal static readonly TimeSpan FirstAttemptDelay = TimeSpan.FromMinutes(1);

    // Second (and final) backend attempt, measured from when the first attempt actually ran (not
    // from the original save) - since a task is normally picked up within one cron tick of becoming
    // due (see the scheduled Job's cronExpression), first-attempt time and save time+1 minute are
    // close enough in practice that this still lands at roughly save time + 5 minutes, matching "약
    // 1분 후, 5분 후" from the request without needing to thread CreatedAtUtc/SavedAtUtc through
    // every call just to anchor it more precisely.
    internal static readonly TimeSpan SecondAttemptDelay = TimeSpan.FromMinutes(4);

    // Backend-side attempts only - on top of whatever the client itself already tried once before
    // any task here is even registered (see FirstAttemptDelay). Never infinite: once both attempts
    // are spent, the task is deleted and never retried again, regardless of outcome.
    internal const int MaxAttempts = 2;

    // A claimed task whose worker crashed/was killed mid-run must not stay stuck forever - treated
    // as abandoned and reclaimable once its claim is older than this. Comfortably longer than any
    // single attempt (one Instagram fetch, bounded by UrlMetadataResolver's own request budget)
    // could plausibly take.
    internal static readonly TimeSpan StaleClaimThreshold = TimeSpan.FromMinutes(2);

    public async Task<InstagramMetadataRetryRunResult> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        await store.RegisterNewCandidatesAsync(now, DiscoveryWindow, FirstAttemptDelay, cancellationToken);

        var due = await store.ListDueAsync(now, cancellationToken);
        int resolved = 0, rescheduled = 0, gaveUp = 0, alreadySatisfied = 0, skippedNotClaimed = 0;

        foreach (var task in due)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!await store.TryClaimAsync(task.TaskId, now, now - StaleClaimThreshold, cancellationToken))
            {
                // Another concurrent worker run already owns this task - never process the same
                // task twice in the same window.
                skippedNotClaimed++;
                continue;
            }

            var beforeFetch = await store.GetItemMetadataStateAsync(task.ItemId, cancellationToken);
            if (beforeFetch is null)
            {
                // The Item itself is gone (cascade delete should already have removed this task too
                // - defensive only).
                await store.DeleteAsync(task.TaskId, cancellationToken);
                continue;
            }

            if (beforeFetch is { Title: not null, PreviewImageUrl: not null })
            {
                // Fully resolved already by the client's own concurrent attempt (or a user edit) -
                // no fetch needed, no attempt spent.
                await store.DeleteAsync(task.TaskId, cancellationToken);
                alreadySatisfied++;
                continue;
            }

            string? errorCode = null;
            UrlMetadataResult? result = null;
            try
            {
                result = await urlMetadataResolver.ResolveAsync(task.Url, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // ResolveAsync is documented never to throw for an ordinary fetch failure - this is
                // a defensive backstop only (mirrors BlobCleanupService's own catch around
                // DeleteBlobsByPrefixAsync), so a genuinely unexpected failure still counts as this
                // attempt failing rather than aborting the whole run. Not logged here - Application
                // services in this codebase don't log directly (see Program.cs's job runner, which
                // logs the overall run result); only a sanitized error code is kept, same as
                // AccountDeletionBlobCleanup.LastErrorCode.
                errorCode = exception.GetType().Name;
            }

            if (result is { Title: not null } or { PreviewImageUrl: not null })
            {
                // Only fills whichever field(s) are still null - see this store method's own
                // remarks on why this can never overwrite a user edit or the client's own
                // concurrent success.
                await store.ApplyResolvedMetadataAsync(
                    task.ItemId, result.Title, result.PreviewImageUrl, cancellationToken);
            }

            var afterFetch = await store.GetItemMetadataStateAsync(task.ItemId, cancellationToken);
            if (afterFetch is null or { Title: not null, PreviewImageUrl: not null })
            {
                await store.DeleteAsync(task.TaskId, cancellationToken);
                resolved++;
                continue;
            }

            var attemptedAtUtc = timeProvider.GetUtcNow();

            if (task.AttemptCount + 1 >= MaxAttempts)
            {
                // Spent the last allowed attempt with no full resolution - give up for good, never
                // an infinite retry. Deliberately kept (not deleted) - see
                // InstagramMetadataRetryTask.MarkExhausted's own remarks on why deleting here would
                // let a later discovery pass silently re-register and restart the whole 2-attempt
                // cycle for the same Item.
                await store.MarkExhaustedAsync(task.TaskId, attemptedAtUtc, errorCode, cancellationToken);
                gaveUp++;
                continue;
            }

            await store.RecordFailedAttemptAsync(
                task.TaskId, attemptedAtUtc, errorCode, attemptedAtUtc + SecondAttemptDelay, cancellationToken);
            rescheduled++;
        }

        return new InstagramMetadataRetryRunResult(due.Count, resolved, rescheduled, gaveUp, alreadySatisfied, skippedNotClaimed);
    }
}
