using Juple.Domain.Collections;

namespace Juple.Application.Collections.SharePassword;

/// <summary>A Collection's share-password setting as stored (hash and ciphertext stay server-side).</summary>
public sealed record CollectionSharePasswordRecord(
    long CollectionId,
    CollectionSharePasswordMode Mode,
    string? PasswordHash,
    string? EncryptedPassword,
    int PasswordVersion,
    DateTimeOffset UpdatedAtUtc);

/// <summary>What the Owner's Share screen shows - never the password, its hash or its ciphertext.</summary>
/// <param name="Mode">"none", "legacyCommonLock" or "perCollection".</param>
public sealed record CollectionSharePasswordStatusDto(string Mode, bool IsEnabled, DateTimeOffset? UpdatedAtUtc);

public static class CollectionSharePasswordModes
{
    public static string ToWire(CollectionSharePasswordMode mode) => mode switch
    {
        CollectionSharePasswordMode.PerCollection => "perCollection",
        CollectionSharePasswordMode.LegacyCommonLock => "legacyCommonLock",
        _ => "none",
    };
}

public interface ICollectionSharePasswordStore
{
    /// <summary>The Collection's setting, or null when it never had one (the same as None).</summary>
    Task<CollectionSharePasswordRecord?> GetAsync(long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Sets or replaces the Collection's own share password; bumps PasswordVersion.</summary>
    Task SetAsync(long collectionId, string passwordHash, string encryptedPassword, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Removes the protection (either kind); bumps PasswordVersion. A no-op without one.</summary>
    Task RemoveAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

/// <summary>
/// Reversible, authenticated encryption of a share password so its Owner can see it again - under a
/// server-held key (never in the database, the source or the app), bound to the Collection it
/// belongs to. Unprotect fails closed: tampered, foreign or undecryptable input gives null.
/// </summary>
public interface ICollectionSharePasswordProtector
{
    string Protect(long collectionId, string password);

    string? Unprotect(long collectionId, string protectedPassword);
}

/// <summary>The Collection has no share password of its own (nothing to reveal, or to unlock).</summary>
public sealed class CollectionSharePasswordNotSetException()
    : Exception("This Collection has no share password.");

/// <summary>The stored share password cannot be read back (wrong key or damaged data) - set a new one.</summary>
public sealed class CollectionSharePasswordUnreadableException()
    : Exception("The share password cannot be read.");

public interface ICollectionSharePasswordService
{
    /// <summary>Owner only (ManageShare). Never includes the password.</summary>
    Task<CollectionSharePasswordStatusDto> GetStatusAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Owner only; a locked Collection also needs the Owner's lock grant (unlockToken). Sets or
    /// changes the share password - every recipient grant stops working at once.
    /// </summary>
    Task<CollectionSharePasswordStatusDto> SetAsync(
        long userId,
        long collectionId,
        string? password,
        string? confirmPassword,
        string? unlockToken,
        CancellationToken cancellationToken = default);

    /// <summary>Owner only, same gates as SetAsync. Removes the protection - sharing itself is untouched.</summary>
    Task<CollectionSharePasswordStatusDto> RemoveAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default);

    /// <summary>Owner only, same gates as SetAsync. The share password itself - only on this explicit request.</summary>
    Task<string> RevealAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default);

    /// <summary>
    /// A recipient (member) proves the share password: access first (a stranger gets 404 whatever
    /// the password), then the throttled check; returns a short-lived grant for this user, this
    /// Collection and the current password version. The Owner never needs one (409).
    /// </summary>
    Task<Locking.CollectionUnlockGrant> UnlockAsync(long userId, long collectionId, string? password, CancellationToken cancellationToken = default);
}
