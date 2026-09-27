using Juple.Domain.Users;

namespace Juple.Application.Users.Profile;

/// <summary>What a user sees of their own public-facing identity: the optional display name and the Juple ID. Never internal ids or email.</summary>
public sealed record UserProfileDto(string? DisplayName, string JupleId);

public sealed class InvalidDisplayNameException(string message) : Exception(message);

public interface IUserProfileStore
{
    /// <summary>Null when the user no longer exists.</summary>
    Task<UserProfileDto?> GetAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Stores an already-normalized display name (null clears it) and returns the updated profile.</summary>
    Task<UserProfileDto> SetDisplayNameAsync(
        long userId,
        string? displayName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);
}

public interface IUserProfileService
{
    Task<UserProfileDto> GetAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Trims; empty clears the name. Invalid input: InvalidDisplayNameException (nothing is stored).</summary>
    Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, CancellationToken cancellationToken = default);
}

public sealed class UserProfileService(IUserProfileStore store, TimeProvider timeProvider) : IUserProfileService
{
    public async Task<UserProfileDto> GetAsync(long userId, CancellationToken cancellationToken = default) =>
        await store.GetAsync(userId, cancellationToken)
        ?? throw new InvalidOperationException("The current user no longer exists.");

    public Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, CancellationToken cancellationToken = default)
    {
        if (!UserDisplayName.TryNormalize(displayName, out var normalized, out var error))
        {
            throw new InvalidDisplayNameException(error!);
        }

        return store.SetDisplayNameAsync(userId, normalized, timeProvider.GetUtcNow(), cancellationToken);
    }
}
