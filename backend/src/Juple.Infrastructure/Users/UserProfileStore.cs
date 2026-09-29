using Juple.Application.Users.Profile;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users;

public sealed class UserProfileStore(JupleDbContext dbContext) : IUserProfileStore
{
    public async Task<UserProfileRecord?> GetAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new UserProfileRecord(user.DisplayName, user.PublicCode, user.ProfileImageBlobName))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<UserProfileRecord> SetDisplayNameAsync(
        long userId,
        string? displayName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var user = await UpdateWithRetryAsync(userId, entry => entry.SetDisplayName(displayName, updatedAtUtc), cancellationToken);
        return ToRecord(user);
    }

    public async Task<(UserProfileRecord Profile, string? ReplacedBlobName)> SetProfileImageAsync(
        long userId,
        string? blobName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        string? replaced = null;
        var user = await UpdateWithRetryAsync(userId, entry => replaced = entry.SetProfileImage(blobName, updatedAtUtc), cancellationToken);
        return (ToRecord(user), replaced);
    }

    /// <summary>
    /// Applies one profile field change. If another request (e.g. a time zone update) changed the
    /// row first, the change is re-applied once on the fresh row - a nickname or photo edit carries
    /// no stale-read risk of its own, and re-applying also re-reads which photo is being replaced,
    /// so the Blob handed back for deletion is always the one the row actually pointed at.
    /// </summary>
    private async Task<User> UpdateWithRetryAsync(long userId, Action<User> apply, CancellationToken cancellationToken)
    {
        var user = await dbContext.Users.FirstOrDefaultAsync(entry => entry.Id == userId, cancellationToken)
            ?? throw new InvalidOperationException("The current user no longer exists.");

        apply(user);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return user;
        }
        catch (DbUpdateConcurrencyException)
        {
            dbContext.ChangeTracker.Clear();
            var fresh = await dbContext.Users.FirstOrDefaultAsync(entry => entry.Id == userId, cancellationToken)
                ?? throw new InvalidOperationException("The current user no longer exists.");
            apply(fresh);
            await dbContext.SaveChangesAsync(cancellationToken);
            return fresh;
        }
    }

    private static UserProfileRecord ToRecord(User user) =>
        new(user.DisplayName, user.PublicCode, user.ProfileImageBlobName);
}
