namespace Juple.Domain.Collections;

/// <summary>
/// The user's one Collection lock password: every Collection they own and lock is opened with it -
/// by them, by members and through a public link alike. Collections carry only their lock state
/// (IsLocked/LockVersion), never a password of their own any more. Collections.LockPasswordHash is a
/// legacy per-Collection password kept only for owners who have no row here yet (see
/// CollectionLockPasswordSource); once a row exists it is never consulted again.
///
/// Created or replaced only through Settings > 컬렉션 잠금: a change (current password) or a
/// set/reset after a recent real sign-in. Rows written in the Round 5 period are the same thing and
/// are used as-is.
///
/// PasswordHash is a versioned salted hash (CollectionLockPasswordHasher) - never the password.
/// FailedChangeAttemptCount/FailedChangeWindowStartedAtUtc throttle wrong current passwords on a
/// change, persisted so the limit holds across API replicas.
/// </summary>
public sealed class UserCollectionLockSettings
{
    private UserCollectionLockSettings()
    {
    }

    public UserCollectionLockSettings(long userId, string passwordHash, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        PasswordHash = passwordHash;
        CreatedAtUtc = createdAtUtc;
        PasswordChangedAtUtc = createdAtUtc;
    }

    public long UserId { get; private set; }

    public string PasswordHash { get; private set; } = null!;

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset PasswordChangedAtUtc { get; private set; }

    public int FailedChangeAttemptCount { get; private set; }

    public DateTimeOffset? FailedChangeWindowStartedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>Replaces the password (change or reset) and clears the failed-change counter.</summary>
    public void ReplacePassword(string passwordHash, DateTimeOffset changedAtUtc)
    {
        PasswordHash = passwordHash;
        PasswordChangedAtUtc = changedAtUtc;
        FailedChangeAttemptCount = 0;
        FailedChangeWindowStartedAtUtc = null;
    }

    /// <summary>When wrong current passwords stop being accepted (null when a change may be tried).</summary>
    public DateTimeOffset? ChangeBlockedUntil(DateTimeOffset nowUtc)
    {
        if (FailedChangeWindowStartedAtUtc is not { } startedAtUtc)
        {
            return null;
        }

        var windowEndsAtUtc = startedAtUtc + CollectionUnlockThrottle.Window;
        return FailedChangeAttemptCount >= CollectionUnlockThrottle.MaxFailures && windowEndsAtUtc > nowUtc
            ? windowEndsAtUtc
            : null;
    }

    public void RecordFailedChange(DateTimeOffset nowUtc)
    {
        if (FailedChangeWindowStartedAtUtc is not { } startedAtUtc || startedAtUtc + CollectionUnlockThrottle.Window <= nowUtc)
        {
            FailedChangeWindowStartedAtUtc = nowUtc;
            FailedChangeAttemptCount = 0;
        }

        FailedChangeAttemptCount++;
    }
}
