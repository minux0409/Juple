namespace Juple.Application.Items.InstagramMetadataRetry;

public sealed record DueInstagramMetadataRetryTaskDto(long TaskId, long ItemId, string Url, int AttemptCount);

/// <summary>
/// Data access for InstagramMetadataRetryTask. Business policy (how many attempts, how long to
/// wait, when to give up) lives in InstagramMetadataRetryService, not here - this store only ever
/// does what it is explicitly told.
/// </summary>
public interface IInstagramMetadataRetryStore
{
    /// <summary>
    /// Finds Instagram Items saved within [now - discoveryWindow, now - firstAttemptDelay] that
    /// still have no Title and/or no PreviewImageUrl and have no retry task registered yet, and
    /// registers one (NextAttemptAtUtc = now, i.e. immediately due) for each. The lower bound
    /// (discoveryWindow) is a deliberate, permanent cutoff - not a startup-only concern - so this
    /// never becomes an unbounded scan over the whole Items history and never mass-retries old
    /// Instagram Items that predate this feature; only Items saved recently enough to still be
    /// within their normal retry window are ever newly registered. Safe under concurrent runs: a
    /// unique index on ItemId means a losing concurrent insert for the same Item is swallowed, not
    /// thrown.
    /// </summary>
    Task RegisterNewCandidatesAsync(
        DateTimeOffset now,
        TimeSpan discoveryWindow,
        TimeSpan firstAttemptDelay,
        CancellationToken cancellationToken = default);

    /// <summary>Tasks currently due (NextAttemptAtUtc &lt;= now), regardless of claim state - callers
    /// must still call TryClaimAsync before acting on one.</summary>
    Task<IReadOnlyList<DueInstagramMetadataRetryTaskDto>> ListDueAsync(
        DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atomically claims one task for this worker run - true only if this call itself transitioned
    /// it from unclaimed (or staled-out) to claimed. A single conditional UPDATE, so two concurrent
    /// callers racing on the same task can never both receive true.
    /// </summary>
    Task<bool> TryClaimAsync(
        long taskId,
        DateTimeOffset claimedAtUtc,
        DateTimeOffset staleClaimBeforeUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Current Title/PreviewImageUrl for the task's Item, or null if the Item no longer
    /// exists. Read fresh immediately before (and again immediately after) attempting a fetch, so a
    /// concurrent client success or user edit is never clobbered.</summary>
    Task<(string? Title, string? PreviewImageUrl)?> GetItemMetadataStateAsync(
        long itemId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies a freshly resolved title/preview image to the Item, but only into whichever field(s)
    /// are still null right now - a single conditional (COALESCE-style) UPDATE, so this can never
    /// overwrite a value a user already edited or the client's own concurrent attempt already set,
    /// no matter how close the timing. Passing null for either value simply leaves that field alone.
    /// </summary>
    Task ApplyResolvedMetadataAsync(
        long itemId, string? title, string? previewImageUrl, CancellationToken cancellationToken = default);

    /// <summary>The task is fully resolved (or its Item is gone) - removes it. A no-op if already
    /// gone (e.g. a concurrent run finished it first).</summary>
    Task DeleteAsync(long taskId, CancellationToken cancellationToken = default);

    /// <summary>Records a completed attempt that did not fully resolve the Item yet, with attempts
    /// still remaining. A no-op if the task is already gone.</summary>
    Task RecordFailedAttemptAsync(
        long taskId,
        DateTimeOffset attemptedAtUtc,
        string? errorCode,
        DateTimeOffset nextAttemptAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Records the last allowed attempt spending itself with no full resolution - see
    /// InstagramMetadataRetryTask.MarkExhausted's own remarks on why this deliberately does NOT
    /// delete the row (unlike DeleteAsync's use for a fully-resolved task). A no-op if the task is
    /// already gone.</summary>
    Task MarkExhaustedAsync(
        long taskId, DateTimeOffset attemptedAtUtc, string? errorCode, CancellationToken cancellationToken = default);
}
