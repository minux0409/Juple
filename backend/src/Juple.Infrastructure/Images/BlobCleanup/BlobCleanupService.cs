using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Images.BlobCleanup;

public sealed class BlobCleanupService(
    IAccountDeletionBlobCleanupStore cleanupStore,
    IItemImageStorage itemImageStorage,
    TimeProvider timeProvider,
    ILogger<BlobCleanupService> logger) : IBlobCleanupService
{
    // There is no upload SAS in this codebase - every Item image upload is a synchronous,
    // authenticated POST to the Backend (see ItemImagesController/ItemImageStore.UploadAsync),
    // never a client-held, independently-expiring credential. So the only way a Blob can land
    // under a just-deleted user's prefix is a request that was already authenticated and had
    // already passed its ownership check (RequireOwnedItemAsync) before the account deletion
    // transaction committed, and whose Blob PUT is still in flight when the immediate
    // post-deletion sweep runs. That request's own subsequent ItemImages insert then fails on the
    // ItemImages -> Items FK (the Item row is already gone) and triggers a compensating delete -
    // but that delete is itself only best-effort, so a single "prefix is clean" result is not
    // proof it will stay clean. This grace period is set to comfortably outlive
    // apps/mobile/src/images/api/imagesApi.ts's UPLOAD_TIMEOUT_MS (120s, the client's own upload
    // request timeout - the real, code-derived bound on how long such a request can still be in
    // flight), with a generous margin for network/cancellation-propagation latency and client-
    // server clock skew. If UPLOAD_TIMEOUT_MS ever changes materially, revisit this value too.
    private static readonly TimeSpan GracePeriod = TimeSpan.FromMinutes(10);


    public async Task<bool> TryCleanupAsync(long cleanupTaskId, CancellationToken cancellationToken = default)
    {
        var task = await cleanupStore.GetAsync(cleanupTaskId, cancellationToken);
        if (task is null)
        {
            // Already cleaned up - e.g. a concurrent retry run finished it first.
            return true;
        }

        return await ProcessAsync(task, cancellationToken) == CleanupOutcome.Removed;
    }

    public async Task<BlobCleanupRunResult> RunPendingCleanupsAsync(CancellationToken cancellationToken = default)
    {
        var pending = await cleanupStore.ListPendingAsync(cancellationToken);
        var succeeded = 0;
        var failed = 0;
        var deferred = 0;

        foreach (var task in pending)
        {
            switch (await ProcessAsync(task, cancellationToken))
            {
                case CleanupOutcome.Removed:
                    succeeded++;
                    break;
                case CleanupOutcome.Deferred:
                    deferred++;
                    break;
                case CleanupOutcome.Failed:
                    failed++;
                    break;
            }
        }

        return new BlobCleanupRunResult(pending.Count, succeeded, failed, deferred);
    }

    // Distinguishes a genuine failure from ordinary, expected progress (first-time-clean or
    // awaiting grace period) - see BlobCleanupRunResult's own remarks on why RunPendingCleanupsAsync
    // needs this instead of just the bool TryCleanupAsync uses.
    private enum CleanupOutcome
    {
        Removed,
        Deferred,
        Failed,
    }

    private async Task<CleanupOutcome> ProcessAsync(PendingBlobCleanupDto task, CancellationToken cancellationToken)
    {
        bool succeeded;
        string? errorCode;
        try
        {
            succeeded = await itemImageStorage.DeleteBlobsByPrefixAsync(task.BlobPrefix, cancellationToken);
            errorCode = succeeded ? null : "BlobDeleteIncomplete";
        }
        catch (Exception exception)
        {
            // DeleteBlobsByPrefixAsync is itself designed never to throw - this is a defensive
            // backstop only, so a genuinely unexpected failure is still recorded rather than
            // aborting a whole retry run. Only the exception's type name is kept - see
            // AccountDeletionBlobCleanup's own remarks on never storing sensitive content here.
            succeeded = false;
            errorCode = exception.GetType().Name;
        }

        if (!succeeded)
        {
            logger.LogWarning(
                "Blob cleanup attempt failed for cleanup task {CleanupTaskId} (attempt {AttemptNumber}).",
                task.Id, task.AttemptCount + 1);
            await cleanupStore.RecordFailedAttemptAsync(
                task.Id, errorCode, timeProvider.GetUtcNow(), cancellationToken);
            return CleanupOutcome.Failed;
        }

        var now = timeProvider.GetUtcNow();

        // The prefix is clean right now, but see this class's own remarks on GracePeriod for why
        // that alone isn't proof it will stay clean - a task is only removed once a cleanup
        // attempt finds it clean a second time, at or after FinalSweepAfterUtc.
        if (task.FinalSweepAfterUtc is null)
        {
            await cleanupStore.ScheduleFinalSweepAsync(task.Id, now + GracePeriod, cancellationToken);
            return CleanupOutcome.Deferred;
        }

        if (now < task.FinalSweepAfterUtc)
        {
            // Confirmed clean once already, but the grace period from that first confirmation
            // hasn't elapsed yet - nothing more to do until a later attempt (immediate retries
            // before then would just re-confirm the same thing).
            return CleanupOutcome.Deferred;
        }

        await cleanupStore.DeleteAsync(task.Id, cancellationToken);
        return CleanupOutcome.Removed;
    }
}
