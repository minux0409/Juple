using Juple.Application.Collections.Collaboration;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users;

/// <summary>Exact Juple ID resolution only (UX_Users_PublicCode) - no partial match, no listing.</summary>
public sealed class UserDirectoryStore(JupleDbContext dbContext) : IUserDirectoryStore
{
    public async Task<long?> FindUserIdByPublicCodeAsync(string publicCode, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.PublicCode == publicCode)
            .Select(user => (long?)user.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<string?> GetPublicCodeAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => user.PublicCode)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<string?> GetDisplayNameAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => user.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);
}
