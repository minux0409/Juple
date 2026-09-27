using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;

namespace Juple.UnitTests.Collections;

/// <summary>An ICollectionAccessStore backed by a plain dictionary (collectionId → owner, collaborators, lock).</summary>
internal sealed class InMemoryCollectionAccessStore : ICollectionAccessStore
{
    public Dictionary<long, (long OwnerId, HashSet<long> Collaborators, bool IsLocked, int LockVersion)> Collections { get; } = [];

    public InMemoryCollectionAccessStore Add(long collectionId, long ownerId, params long[] collaborators)
    {
        Collections[collectionId] = (ownerId, [.. collaborators], false, 0);
        return this;
    }

    public void SetLock(long collectionId, bool isLocked, int lockVersion)
    {
        var entry = Collections[collectionId];
        Collections[collectionId] = (entry.OwnerId, entry.Collaborators, isLocked, lockVersion);
    }

    public Task<CollectionAccess?> FindAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        if (!Collections.TryGetValue(collectionId, out var entry))
        {
            return Task.FromResult<CollectionAccess?>(null);
        }

        CollectionAccess? access = entry.OwnerId == userId
            ? new CollectionAccess(collectionId, CollectionAccessRole.Owner, entry.IsLocked, entry.LockVersion)
            : entry.Collaborators.Contains(userId)
                ? new CollectionAccess(collectionId, CollectionAccessRole.Contributor, entry.IsLocked, entry.LockVersion)
                : null;
        return Task.FromResult(access);
    }
}

/// <summary>Grants "valid:{collectionId}:{kind}{id}:{lockVersion}" tokens - only for exercising the gate logic around them.</summary>
internal sealed class FakeUnlockTokenProtector : ICollectionUnlockTokenProtector
{
    public CollectionUnlockGrant Issue(long collectionId, CollectionUnlockSubject subject, int lockVersion, DateTimeOffset nowUtc) =>
        new(Token(collectionId, subject, lockVersion), nowUtc.AddMinutes(15));

    public bool IsValid(string? token, long collectionId, CollectionUnlockSubject subject, int lockVersion, DateTimeOffset nowUtc) =>
        token == Token(collectionId, subject, lockVersion);

    public static string Token(long collectionId, CollectionUnlockSubject subject, int lockVersion) =>
        $"valid:{collectionId}:{subject.Kind}{subject.Id}:{lockVersion}";
}

/// <summary>
/// In-memory ICollectionLockStore with the real CollectionUnlockThrottle rules. States holds each
/// Collection's own (legacy) hash; GetStateAsync resolves the one that opens it through the
/// production rule (CollectionLockPasswordSource): the Owner's lock password in OwnerPasswords, for
/// Collections registered with OwnedBy, whenever one exists.
/// </summary>
internal sealed class InMemoryCollectionLockStore : ICollectionLockStore
{
    public Dictionary<long, CollectionLockState> States { get; } = [];

    public Dictionary<long, long> Owners { get; } = [];

    public Dictionary<long, string> OwnerPasswords { get; } = [];

    public Dictionary<(long, string), Juple.Domain.Collections.CollectionUnlockThrottle> Throttles { get; } = [];

    public int VerifyCallsBlocked { get; private set; }

    public InMemoryCollectionLockStore OwnedBy(long collectionId, long ownerId)
    {
        Owners[collectionId] = ownerId;
        return this;
    }

    public InMemoryCollectionLockStore WithOwnerPassword(long ownerId, string passwordHash)
    {
        OwnerPasswords[ownerId] = passwordHash;
        return this;
    }

    /// <summary>Locked; passwordHash is the Collection's own legacy hash (null for a lock under the Owner's password).</summary>
    public InMemoryCollectionLockStore Locked(long collectionId, string? passwordHash, int lockVersion = 1)
    {
        States[collectionId] = new CollectionLockState(collectionId, true, passwordHash, lockVersion);
        return this;
    }

    public InMemoryCollectionLockStore Unlocked(long collectionId)
    {
        States[collectionId] = new CollectionLockState(collectionId, false, null, 0);
        return this;
    }

    public Task<CollectionLockState?> GetStateAsync(long collectionId, CancellationToken cancellationToken = default)
    {
        if (!States.TryGetValue(collectionId, out var state))
        {
            return Task.FromResult<CollectionLockState?>(null);
        }

        var ownerPassword = Owners.TryGetValue(collectionId, out var ownerId) ? OwnerPasswords.GetValueOrDefault(ownerId) : null;
        var (passwordHash, usesOwnerPassword) = CollectionLockPasswordSource.Resolve(state.PasswordHash, ownerPassword);
        return Task.FromResult<CollectionLockState?>(state with { PasswordHash = passwordHash, UsesOwnerPassword = usesOwnerPassword });
    }

    public Task LockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var current = States[collectionId];
        if (!current.IsLocked)
        {
            States[collectionId] = current with { IsLocked = true, LockVersion = current.LockVersion + 1 };
        }

        return Task.CompletedTask;
    }

    public Task RemoveLockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var current = States[collectionId];
        States[collectionId] = new CollectionLockState(collectionId, false, null, current.LockVersion + 1);
        return Task.CompletedTask;
    }

    public Task<DateTimeOffset?> GetBlockedUntilAsync(long collectionId, string subjectKey, int maxFailures, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var blockedUntil = Throttles.TryGetValue((collectionId, subjectKey), out var throttle) ? throttle.BlockedUntil(nowUtc, maxFailures) : null;
        if (blockedUntil is not null)
        {
            VerifyCallsBlocked++;
        }

        return Task.FromResult(blockedUntil);
    }

    public Task RecordFailureAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (!Throttles.TryGetValue((collectionId, subjectKey), out var throttle))
        {
            throttle = new Juple.Domain.Collections.CollectionUnlockThrottle(collectionId, subjectKey, nowUtc);
            Throttles[(collectionId, subjectKey)] = throttle;
        }

        throttle.RecordFailure(nowUtc);
        return Task.CompletedTask;
    }

    public Task ResetFailuresAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        Throttles.Remove((collectionId, subjectKey));
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory ICollectionLockSettingsStore sharing the lock store's Owner passwords, so a set/change
/// is seen by every unlock exactly like the single production table.
/// </summary>
internal sealed class InMemoryCollectionLockSettingsStore(InMemoryCollectionLockStore locks) : ICollectionLockSettingsStore
{
    public Dictionary<long, Juple.Domain.Collections.UserCollectionLockSettings> Rows { get; } = [];

    public Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(Rows.TryGetValue(userId, out var row)
            ? new CollectionLockPasswordStatusDto(true, row.PasswordChangedAtUtc)
            : new CollectionLockPasswordStatusDto(false, null));

    public Task<CollectionLockPasswordRecord?> GetAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        Task.FromResult(Rows.TryGetValue(userId, out var row)
            ? new CollectionLockPasswordRecord(row.PasswordHash, row.ChangeBlockedUntil(nowUtc))
            : null);

    public Task RecordFailedChangeAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (Rows.TryGetValue(userId, out var row))
        {
            row.RecordFailedChange(nowUtc);
        }

        return Task.CompletedTask;
    }

    public Task SetPasswordAsync(long userId, string passwordHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (Rows.TryGetValue(userId, out var row))
        {
            row.ReplacePassword(passwordHash, nowUtc);
        }
        else
        {
            Rows[userId] = new Juple.Domain.Collections.UserCollectionLockSettings(userId, passwordHash, nowUtc);
        }

        locks.OwnerPasswords[userId] = passwordHash;
        foreach (var (collectionId, ownerId) in locks.Owners.Where(entry => entry.Value == userId).ToList())
        {
            var state = locks.States[collectionId];
            if (state.IsLocked)
            {
                locks.States[collectionId] = state with { LockVersion = state.LockVersion + 1 };
            }

            locks.Throttles.Remove((collectionId, CollectionUnlockSubject.ForUser(userId).ThrottleKey));
        }

        return Task.CompletedTask;
    }
}

/// <summary>Deterministic stand-in so service tests don't pay PBKDF2 cost; the real hasher has its own tests.</summary>
internal sealed class FakePasswordHasher : ICollectionLockPasswordHasher
{
    public string Hash(string password) => "hash:" + password;

    public bool Verify(string passwordHash, string password) => passwordHash == "hash:" + password;
}

internal sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}

internal static class CollectionAccessTestDoubles
{
    /// <summary>A real CollectionAccessService where userId 17 owns every listed collection.</summary>
    public static CollectionAccessService OwnerOf(params long[] collectionIds)
    {
        var store = new InMemoryCollectionAccessStore();
        foreach (var collectionId in collectionIds)
        {
            store.Add(collectionId, ownerId: 17);
        }

        return new CollectionAccessService(store, new FakeUnlockTokenProtector(), TimeProvider.System);
    }
}
