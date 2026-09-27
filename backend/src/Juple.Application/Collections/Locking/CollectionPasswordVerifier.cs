namespace Juple.Application.Collections.Locking;

/// <summary>
/// The one throttled password check used by every unlock/lock-management path: refuses outright
/// while any of the attempt's buckets (see CollectionUnlockBuckets) is blocked - before any hashing
/// work - records a failure in every bucket on a wrong password, and on success clears the buckets
/// that allow it (a per-subject one), never a shared ceiling.
/// </summary>
public sealed class CollectionPasswordVerifier(
    ICollectionLockStore lockStore,
    ICollectionLockPasswordHasher passwordHasher)
{
    public Task VerifyAsync(
        CollectionLockState state,
        CollectionUnlockSubject subject,
        string? password,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken) =>
        VerifyAsync(state, CollectionUnlockBuckets.ForUser(subject.Id), password, nowUtc, cancellationToken);

    public async Task VerifyAsync(
        CollectionLockState state,
        IReadOnlyList<CollectionUnlockBucket> buckets,
        string? password,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        DateTimeOffset? blockedUntil = null;
        foreach (var bucket in buckets)
        {
            if (await lockStore.GetBlockedUntilAsync(state.CollectionId, bucket.Key, bucket.MaxFailures, nowUtc, cancellationToken) is { } until
                && (blockedUntil is null || until > blockedUntil))
            {
                blockedUntil = until;
            }
        }

        if (blockedUntil is { } retryAfter)
        {
            throw new CollectionUnlockThrottledException(retryAfter);
        }

        if (string.IsNullOrEmpty(password)
            || password.Length > CollectionLockPasswordPolicy.MaxLength
            || state.PasswordHash is null
            || !passwordHasher.Verify(state.PasswordHash, password))
        {
            foreach (var bucket in buckets)
            {
                await lockStore.RecordFailureAsync(state.CollectionId, bucket.Key, nowUtc, cancellationToken);
            }

            throw new InvalidCollectionPasswordException();
        }

        foreach (var bucket in buckets.Where(bucket => bucket.ResetOnSuccess))
        {
            await lockStore.ResetFailuresAsync(state.CollectionId, bucket.Key, nowUtc, cancellationToken);
        }
    }
}
