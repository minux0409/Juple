namespace Juple.Domain.Images;

/// <summary>
/// A durable record that a Blob Storage prefix still needs deleting after an account deletion's
/// SQL transaction has already committed (see AccountDeletionStore/DeleteAccountService). Created
/// in the SAME transaction as the rest of that user's data deletion, so a failed account deletion
/// never leaves an orphan cleanup task, and a committed one is guaranteed to have one.
///
/// Deliberately carries no UserId/FK to User or any other user data (no email, URL, memo, or
/// token) - only the raw Blob prefix - so retry remains possible after the User row itself is
/// gone. Removed entirely once BlobCleanupService confirms the prefix is clean a second time,
/// strictly after <see cref="FinalSweepAfterUtc"/> - see that property's own remarks for why a
/// single "found nothing" isn't enough. While it exists, its Id is a purely internal operational
/// handle, never user-facing.
/// </summary>
public sealed class AccountDeletionBlobCleanup
{
    private AccountDeletionBlobCleanup()
    {
    }

    public AccountDeletionBlobCleanup(string blobPrefix, DateTimeOffset createdAtUtc)
    {
        BlobPrefix = blobPrefix;
        CreatedAtUtc = createdAtUtc;
        AttemptCount = 0;
    }

    public long Id { get; private set; }

    public string BlobPrefix { get; private set; } = null!;

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset? LastAttemptAtUtc { get; private set; }

    /// <summary>A sanitized code (e.g. an exception type name) - never a raw exception message or
    /// any Blob/account content. See this class's own remarks on carrying no sensitive data.</summary>
    public string? LastErrorCode { get; private set; }

    /// <summary>
    /// Null until a cleanup attempt first finds the prefix already clean. An upload request that
    /// was already authenticated and had already passed its ownership check before account
    /// deletion committed can still land a Blob under this prefix afterward (its own
    /// FK-constrained ItemImages insert then fails and triggers a compensating delete, but that is
    /// itself only best-effort) - so a single clean result is not proof the prefix will STAY
    /// clean. Once set, the task is only removed by a cleanup attempt that finds the prefix clean
    /// AGAIN at or after this time (see BlobCleanupService.GracePeriod for how far out this is set,
    /// and why).
    /// </summary>
    public DateTimeOffset? FinalSweepAfterUtc { get; private set; }

    public void RecordFailedAttempt(string? errorCode, DateTimeOffset attemptedAtUtc)
    {
        AttemptCount++;
        LastAttemptAtUtc = attemptedAtUtc;
        LastErrorCode = errorCode;
    }

    /// <summary>Called the first time a cleanup attempt finds the prefix clean - schedules the
    /// earliest time a second, confirming clean result is allowed to actually remove this task.</summary>
    public void ScheduleFinalSweep(DateTimeOffset finalSweepAfterUtc)
    {
        FinalSweepAfterUtc = finalSweepAfterUtc;
    }
}
