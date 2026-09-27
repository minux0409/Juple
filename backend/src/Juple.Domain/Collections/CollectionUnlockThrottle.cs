namespace Juple.Domain.Collections;

/// <summary>
/// Persisted (not per-process) failed-unlock counter for one Collection and one attempt bucket, so
/// the limit holds across every API replica. Buckets (see CollectionUnlockBuckets): an authenticated
/// user ("u:{userId}"), one anonymous browser of a public share link ("pc:{shareId}:{client}"), and
/// the public share link as a whole ("p:{shareId}", a much higher safety ceiling). A window opens at
/// the first failure; once the bucket's limit is reached, attempts are refused until it ends.
/// </summary>
public sealed class CollectionUnlockThrottle
{
    /// <summary>Default per-subject limit (a signed-in user, or one anonymous browser).</summary>
    public const int MaxFailures = 5;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private CollectionUnlockThrottle()
    {
    }

    public CollectionUnlockThrottle(long collectionId, string subjectKey, DateTimeOffset nowUtc)
    {
        CollectionId = collectionId;
        SubjectKey = subjectKey;
        WindowStartedAtUtc = nowUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public string SubjectKey { get; private set; } = null!;

    public int FailedAttemptCount { get; private set; }

    public DateTimeOffset WindowStartedAtUtc { get; private set; }

    /// <summary>When the current window ends (null when attempts are currently allowed).</summary>
    public DateTimeOffset? BlockedUntil(DateTimeOffset nowUtc, int maxFailures = MaxFailures)
    {
        var windowEndsAtUtc = WindowStartedAtUtc + Window;
        return FailedAttemptCount >= maxFailures && windowEndsAtUtc > nowUtc ? windowEndsAtUtc : null;
    }

    public void RecordFailure(DateTimeOffset nowUtc)
    {
        if (WindowStartedAtUtc + Window <= nowUtc)
        {
            WindowStartedAtUtc = nowUtc;
            FailedAttemptCount = 0;
        }

        FailedAttemptCount++;
    }

    public void Reset(DateTimeOffset nowUtc)
    {
        FailedAttemptCount = 0;
        WindowStartedAtUtc = nowUtc;
    }
}
