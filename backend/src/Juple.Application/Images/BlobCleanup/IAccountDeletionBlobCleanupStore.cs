namespace Juple.Application.Images.BlobCleanup;

/// <summary>Mirrors AccountDeletionBlobCleanup's own fields, minus the ones a caller of this store
/// never needs (LastAttemptAtUtc/LastErrorCode are write-only from here - see RecordFailedAttemptAsync).</summary>
public sealed record PendingBlobCleanupDto(long Id, string BlobPrefix, int AttemptCount, DateTimeOffset? FinalSweepAfterUtc);

/// <summary>
/// Read/update access to pending AccountDeletionBlobCleanup rows. Deliberately has no "create" -
/// a cleanup task is only ever created by AccountDeletionStore, inside the same SQL transaction as
/// the rest of that account's data deletion (see that class's own remarks), never through this
/// store.
/// </summary>
public interface IAccountDeletionBlobCleanupStore
{
    Task<PendingBlobCleanupDto?> GetAsync(long id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PendingBlobCleanupDto>> ListPendingAsync(CancellationToken cancellationToken = default);

    /// <summary>A no-op if the row no longer exists (e.g. a concurrent run already deleted it).</summary>
    Task RecordFailedAttemptAsync(
        long id, string? errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records that a cleanup attempt found the prefix clean for the first time - see
    /// AccountDeletionBlobCleanup.FinalSweepAfterUtc's own remarks on why this alone doesn't
    /// remove the task yet. A no-op if the row no longer exists.
    /// </summary>
    Task ScheduleFinalSweepAsync(
        long id, DateTimeOffset finalSweepAfterUtc, CancellationToken cancellationToken = default);

    /// <summary>Removes the task once its Blob prefix is confirmed clean a second time, at or after
    /// its FinalSweepAfterUtc. A no-op if already gone.</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken = default);
}
