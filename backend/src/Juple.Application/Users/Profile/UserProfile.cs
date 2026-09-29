using Juple.Application.Images;

namespace Juple.Application.Users.Profile;

/// <summary>
/// What a user sees of their own profile: the optional nickname (DisplayName), the Juple ID, the
/// profile photo (short-lived URL + stable version, both null without a photo) and how they sign
/// in. Never internal ids. SignInMethod is filled from the current access token by the API (see
/// Juple.Api SignInMethodClaim) - Juple stores no password and no provider record of its own.
/// </summary>
public sealed record UserProfileDto(
    string? DisplayName,
    string JupleId,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null,
    string? SignInMethod = null);

/// <summary>A user's stored profile fields, before the photo is signed.</summary>
public sealed record UserProfileRecord(string? DisplayName, string JupleId, string? ProfileImageBlobName);

/// <summary>400 with a stable code (see NicknameErrorCodes) - nothing was stored.</summary>
public sealed class InvalidDisplayNameException(string code) : Exception("The nickname was rejected: " + code)
{
    public string Code { get; } = code;
}

public interface IUserProfileStore
{
    /// <summary>Null when the user no longer exists.</summary>
    Task<UserProfileRecord?> GetAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Stores an already-validated nickname (null clears it) and returns the updated profile.</summary>
    Task<UserProfileRecord> SetDisplayNameAsync(
        long userId,
        string? displayName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Sets (or, with null, clears) the photo; returns the updated profile and the Blob it replaced, if any.</summary>
    Task<(UserProfileRecord Profile, string? ReplacedBlobName)> SetProfileImageAsync(
        long userId,
        string? blobName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);
}

public interface IUserProfileService
{
    Task<UserProfileDto> GetAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Validated by NicknamePolicy (the only nickname write path); empty clears the nickname.
    /// Invalid input: InvalidDisplayNameException with a stable code (nothing is stored).
    /// </summary>
    Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, CancellationToken cancellationToken = default);

    /// <summary>
    /// The caller's own photo only (userId comes from the authenticated principal). JPEG/PNG/WebP by
    /// magic bytes, at most <see cref="UserProfileService.MaxProfileImageByteLength"/>. The new Blob
    /// is saved before the row changes and the old Blob is deleted only after - a failure at any
    /// step leaves the previous photo in place. InvalidItemImageException for a bad file.
    /// </summary>
    Task<UserProfileDto> SetProfileImageAsync(long userId, byte[]? content, CancellationToken cancellationToken = default);

    /// <summary>Back to the fallback avatar; idempotent when there is no photo.</summary>
    Task<UserProfileDto> RemoveProfileImageAsync(long userId, CancellationToken cancellationToken = default);
}

public sealed class UserProfileService(
    IUserProfileStore store,
    TimeProvider timeProvider,
    IUserProfileImageStorage? profileImageStorage = null) : IUserProfileService
{
    /// <summary>An avatar is shown at most ~72dp wide and the app resizes to 512px first - a backstop only.</summary>
    public const long MaxProfileImageByteLength = 5 * 1024 * 1024;

    public async Task<UserProfileDto> GetAsync(long userId, CancellationToken cancellationToken = default) =>
        await ToDtoAsync(
            userId,
            await store.GetAsync(userId, cancellationToken) ?? throw new InvalidOperationException("The current user no longer exists."),
            cancellationToken);

    public async Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, CancellationToken cancellationToken = default)
    {
        var verdict = NicknamePolicy.Evaluate(displayName, out var normalized);
        if (verdict != NicknameVerdict.Valid)
        {
            throw new InvalidDisplayNameException(NicknameErrorCodes.For(verdict));
        }

        return await ToDtoAsync(
            userId,
            await store.SetDisplayNameAsync(userId, normalized, timeProvider.GetUtcNow(), cancellationToken),
            cancellationToken);
    }

    public async Task<UserProfileDto> SetProfileImageAsync(long userId, byte[]? content, CancellationToken cancellationToken = default)
    {
        if (content is null || content.Length == 0)
        {
            throw new InvalidItemImageException("file", "An image file is required.");
        }

        if (content.LongLength > MaxProfileImageByteLength)
        {
            throw new InvalidItemImageException("file", "Image must be 5MB or smaller.");
        }

        // Only the file's own bytes decide the format - never a client-supplied type or name.
        var format = ImageFormatDetector.Detect(content)
            ?? throw new InvalidItemImageException("file", "Only JPEG, PNG, or WebP images are allowed.");

        var storage = RequireStorage();
        var blobName = await storage.UploadProfileImageAsync(userId, format, content, cancellationToken);
        (UserProfileRecord Profile, string? ReplacedBlobName) result;
        try
        {
            result = await store.SetProfileImageAsync(userId, blobName, timeProvider.GetUtcNow(), cancellationToken);
        }
        catch
        {
            // Not saved: the previous photo stays, and the new Blob is an orphan.
            await storage.DeleteProfileImageAsync(userId, blobName, CancellationToken.None);
            throw;
        }

        if (result.ReplacedBlobName is { } replaced)
        {
            await storage.DeleteProfileImageAsync(userId, replaced, CancellationToken.None);
        }

        return await ToDtoAsync(userId, result.Profile, cancellationToken);
    }

    public async Task<UserProfileDto> RemoveProfileImageAsync(long userId, CancellationToken cancellationToken = default)
    {
        var (profile, replaced) = await store.SetProfileImageAsync(userId, null, timeProvider.GetUtcNow(), cancellationToken);
        if (replaced is not null)
        {
            await RequireStorage().DeleteProfileImageAsync(userId, replaced, CancellationToken.None);
        }

        return await ToDtoAsync(userId, profile, cancellationToken);
    }

    private IUserProfileImageStorage RequireStorage() =>
        profileImageStorage ?? throw new InvalidOperationException("Profile image storage is not configured.");

    private async Task<UserProfileDto> ToDtoAsync(long userId, UserProfileRecord record, CancellationToken cancellationToken)
    {
        var image = await profileImageStorage.ResolveProfileImageAsync(userId, record.ProfileImageBlobName, cancellationToken);
        return new UserProfileDto(record.DisplayName, record.JupleId, image.Url, image.Version);
    }
}
