using Juple.Application.Users.Profile;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users;

public sealed class UserProfileStore(JupleDbContext dbContext) : IUserProfileStore
{
    public async Task<UserProfileDto?> GetAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new UserProfileDto(user.DisplayName, user.PublicCode))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<UserProfileDto> SetDisplayNameAsync(
        long userId,
        string? displayName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.FirstOrDefaultAsync(entry => entry.Id == userId, cancellationToken)
            ?? throw new InvalidOperationException("The current user no longer exists.");

        user.SetDisplayName(displayName, updatedAtUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another request (e.g. a time zone update) changed the row first. A display name
            // edit carries no stale-read risk of its own, so re-apply once on the fresh row.
            dbContext.ChangeTracker.Clear();
            var fresh = await dbContext.Users.FirstAsync(entry => entry.Id == userId, cancellationToken);
            fresh.SetDisplayName(displayName, updatedAtUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
            user = fresh;
        }

        return new UserProfileDto(user.DisplayName, user.PublicCode);
    }
}
