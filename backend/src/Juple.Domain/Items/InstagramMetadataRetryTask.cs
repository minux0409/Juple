namespace Juple.Domain.Items;

/// <summary>
/// Durable backstop for Instagram metadata enrichment. The client's own synchronous best-effort
/// resolve-and-apply call (see enrichItemTitleFromUrlMetadata/enrichItemPreviewImageFromUrlMetadata
/// in the Mobile app) runs once, right after an Item is saved, and is allowed to come back empty -
/// confirmed across several rounds of real-device investigation to be genuinely transient,
/// Instagram-side behavior (the exact same URL fails at one moment and returns full OG metadata
/// minutes later from the same request shape/cookie state/network origin) rather than a defect in
/// this codebase's own request construction. This task records that a given Item still needs
/// another look, and InstagramMetadataRetryService (see its own remarks) gives it up to two more
/// tries on a schedule, driven by the same one-shot scheduled-Job pattern as
/// AccountDeletionBlobCleanup/BlobCleanupService.
///
/// Unlike ItemSaveRequest.ItemId (deliberately not a FK - a historical ledger that must outlive its
/// Item), ItemId here IS a real FK with cascade delete (see InstagramMetadataRetryTaskConfiguration):
/// this task has no meaning once its Item is gone.
/// </summary>
public sealed class InstagramMetadataRetryTask
{
    private InstagramMetadataRetryTask()
    {
    }

    public InstagramMetadataRetryTask(long itemId, DateTimeOffset createdAtUtc, DateTimeOffset nextAttemptAtUtc)
    {
        ItemId = itemId;
        CreatedAtUtc = createdAtUtc;
        NextAttemptAtUtc = nextAttemptAtUtc;
        AttemptCount = 0;
    }

    public long Id { get; private set; }

    public long ItemId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public DateTimeOffset? LastAttemptAtUtc { get; private set; }

    /// <summary>A sanitized code (e.g. an exception type name) - never a raw exception message, URL,
    /// or caption text. Same rationale as AccountDeletionBlobCleanup.LastErrorCode.</summary>
    public string? LastErrorCode { get; private set; }

    /// <summary>
    /// Non-null while a worker run currently owns this task - guards against two overlapping
    /// scheduled-Job executions (or an overlapping manual + scheduled trigger) processing the same
    /// task at once. Cleared after every attempt (success or failure) so the task remains claimable
    /// for its next scheduled attempt; a claim older than
    /// InstagramMetadataRetryService.StaleClaimThreshold is treated as abandoned (a crashed/killed
    /// worker) and can be reclaimed rather than stalling the task forever.
    /// </summary>
    public DateTimeOffset? ClaimedAtUtc { get; private set; }

    /// <summary>Records a completed attempt that did not fully resolve the Item's metadata yet and
    /// schedules the next one. Callers decide separately (via AttemptCount) whether this was the
    /// last allowed attempt - see InstagramMetadataRetryService.MaxAttempts.</summary>
    public void RecordFailedAttempt(DateTimeOffset attemptedAtUtc, string? errorCode, DateTimeOffset nextAttemptAtUtc)
    {
        AttemptCount++;
        LastAttemptAtUtc = attemptedAtUtc;
        LastErrorCode = errorCode;
        NextAttemptAtUtc = nextAttemptAtUtc;
        ClaimedAtUtc = null;
    }

    /// <summary>
    /// Records the last allowed attempt spending itself with no full resolution - gives up for
    /// good. Deliberately NOT deleted (unlike a fully-resolved task): this row's mere continued
    /// existence is what stops discovery from registering a brand new task (and silently resetting
    /// AttemptCount back to zero) for the same Item the next time it is rescanned, for as long as
    /// the Item stays inside the discovery window - see
    /// IInstagramMetadataRetryStore.RegisterNewCandidatesAsync's own remarks. NextAttemptAtUtc is
    /// set to DateTimeOffset.MaxValue so ListDueAsync never selects it again either.
    /// </summary>
    public void MarkExhausted(DateTimeOffset attemptedAtUtc, string? errorCode)
    {
        AttemptCount++;
        LastAttemptAtUtc = attemptedAtUtc;
        LastErrorCode = errorCode;
        NextAttemptAtUtc = DateTimeOffset.MaxValue;
        ClaimedAtUtc = null;
    }
}
