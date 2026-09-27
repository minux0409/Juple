namespace Juple.Application.Collections.Locking;

/// <summary>Whether the user has a Collection lock password, and since when. Never the hash.</summary>
public sealed record CollectionLockPasswordStatusDto(bool IsConfigured, DateTimeOffset? PasswordChangedAtUtc);

/// <summary>The stored lock password hash and, if wrong current passwords are being refused, until when.</summary>
public sealed record CollectionLockPasswordRecord(string PasswordHash, DateTimeOffset? ChangeBlockedUntilUtc);

/// <summary>The user's one Collection lock password (UserCollectionLockSettings).</summary>
public interface ICollectionLockSettingsStore
{
    Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default);

    Task<CollectionLockPasswordRecord?> GetAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Counts one wrong current password on a change (persisted, cross-replica).</summary>
    Task RecordFailedChangeAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// In one transaction: creates or replaces the user's lock password, bumps LockVersion on every
    /// locked Collection they own (so every outstanding unlock grant - in-app and public - stops
    /// working) and clears the user's own failed-unlock counters on those Collections.
    /// </summary>
    Task SetPasswordAsync(long userId, string passwordHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public interface ICollectionLockPasswordService
{
    Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Replaces the lock password after verifying the current one (throttled).</summary>
    Task ChangeAsync(
        long userId,
        string? currentPassword,
        string? newPassword,
        string? confirmPassword,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets the lock password without the current one - the first setup and "forgot password" alike.
    /// Allowed only right after a real sign-in: authenticatedAtUtc is the server-verified
    /// authentication instant of the caller's access token (see RecentAuthentication).
    /// </summary>
    Task ResetAsync(
        long userId,
        string? newPassword,
        string? confirmPassword,
        DateTimeOffset? authenticatedAtUtc,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Settings > 컬렉션 잠금. One policy for setting a password without knowing the current one -
/// first setup included: it always needs a recent real sign-in. A first setup takes over every
/// Collection the user locked with a legacy per-Collection password, so it is exactly as sensitive as
/// a reset, and one rule keeps both paths identical.
/// </summary>
public sealed class CollectionLockPasswordService(
    ICollectionLockSettingsStore settingsStore,
    ICollectionLockPasswordHasher passwordHasher,
    TimeProvider timeProvider) : ICollectionLockPasswordService
{
    public Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default) =>
        settingsStore.GetStatusAsync(userId, cancellationToken);

    public async Task ChangeAsync(
        long userId,
        string? currentPassword,
        string? newPassword,
        string? confirmPassword,
        CancellationToken cancellationToken = default)
    {
        var validPassword = ValidateNewPassword(newPassword, confirmPassword);
        var nowUtc = timeProvider.GetUtcNow();
        var record = await settingsStore.GetAsync(userId, nowUtc, cancellationToken)
            ?? throw new CollectionLockPasswordNotConfiguredException();
        if (record.ChangeBlockedUntilUtc is { } blockedUntil)
        {
            throw new CollectionUnlockThrottledException(blockedUntil);
        }

        if (string.IsNullOrEmpty(currentPassword)
            || currentPassword.Length > CollectionLockPasswordPolicy.MaxLength
            || !passwordHasher.Verify(record.PasswordHash, currentPassword))
        {
            await settingsStore.RecordFailedChangeAsync(userId, nowUtc, cancellationToken);
            throw new InvalidCollectionPasswordException();
        }

        await settingsStore.SetPasswordAsync(userId, passwordHasher.Hash(validPassword), nowUtc, cancellationToken);
    }

    public async Task ResetAsync(
        long userId,
        string? newPassword,
        string? confirmPassword,
        DateTimeOffset? authenticatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        // First, before looking at anything else: no recent sign-in, no reset.
        RecentAuthentication.Require(authenticatedAtUtc, nowUtc);
        var validPassword = ValidateNewPassword(newPassword, confirmPassword);
        await settingsStore.SetPasswordAsync(userId, passwordHasher.Hash(validPassword), nowUtc, cancellationToken);
    }

    private static string ValidateNewPassword(string? newPassword, string? confirmPassword)
    {
        var validPassword = CollectionLockPasswordPolicy.Validate(newPassword, "newPassword");
        if (!string.Equals(validPassword, confirmPassword, StringComparison.Ordinal))
        {
            throw new InvalidCollectionException("confirmPassword", "The passwords do not match.");
        }

        return validPassword;
    }
}
