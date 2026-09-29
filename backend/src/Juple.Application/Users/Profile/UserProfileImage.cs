using System.Security.Cryptography;
using System.Text;
using Juple.Application.Images;

namespace Juple.Application.Users.Profile;

/// <summary>
/// Blob operations for a user's profile photo - the same container, naming root and signing as
/// Item images and Collection icon photos (see IItemImageStorage), so nothing new is provisioned:
/// the Blob lives under the user's own prefix ("items/{userId}/profile/..."), which account
/// deletion's prefix cleanup already removes. Named by the internal UserId only - never an email,
/// Juple ID or nickname.
/// </summary>
public interface IUserProfileImageStorage
{
    /// <summary>Uploads the (already format-verified) bytes under a new random name and returns it.</summary>
    Task<string> UploadProfileImageAsync(
        long userId,
        ImageFormat format,
        byte[] content,
        CancellationToken cancellationToken = default);

    /// <summary>Best-effort, never throws; only ever deletes a Blob under this user's profile prefix.</summary>
    Task DeleteProfileImageAsync(
        long userId,
        string blobName,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A short-lived read URL for the user's profile photo. Callers only ask for people the caller
    /// may already see by nickname (themselves, friends, friend requests, Collection participants
    /// and invitations, an exact Juple ID lookup). Null when it could not be generated (or the name
    /// is outside the user's profile prefix) - clients then show the fallback avatar.
    /// </summary>
    Task<Uri?> CreateProfileImageReadUrlAsync(
        long userId,
        string blobName,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The stable identity of a profile photo, sent next to its short-lived read URL. Every upload gets
/// a new Blob name, so this changes exactly when the photo is replaced or removed - never per
/// response the way the signed URL does. A one-way digest rather than the Blob name itself, so
/// storage layout (and the internal UserId in it) never leaves the server.
/// </summary>
public static class UserProfileImageVersion
{
    public static string From(string blobName) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(blobName)), 0, 8);
}

/// <summary>A person's photo as a DTO carries it: both null when there is no photo (or it could not be signed).</summary>
public sealed record UserProfileImageRef(string? Url, string? Version)
{
    public static readonly UserProfileImageRef None = new(null, null);
}

public static class UserProfileImageStorageExtensions
{
    /// <summary>Signs one person's photo; a missing storage (tests) or photo is simply "no photo". Local signing only - no DB call.</summary>
    public static async Task<UserProfileImageRef> ResolveProfileImageAsync(
        this IUserProfileImageStorage? storage,
        long userId,
        string? blobName,
        CancellationToken cancellationToken = default)
    {
        if (storage is null || blobName is null)
        {
            return UserProfileImageRef.None;
        }

        var url = await storage.CreateProfileImageReadUrlAsync(userId, blobName, cancellationToken);
        return url is null ? UserProfileImageRef.None : new UserProfileImageRef(url.ToString(), UserProfileImageVersion.From(blobName));
    }
}
