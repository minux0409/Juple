using Juple.Application.DataExport;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.DataExport;

public sealed class DataExportLinkStore(JupleDbContext dbContext) : IDataExportLinkStore
{
    public Task<int> CountExportsSinceAsync(long userId, DateTimeOffset sinceUtc, CancellationToken cancellationToken = default) =>
        dbContext.DataExportLinks
            .AsNoTracking()
            .CountAsync(link => link.UserId == userId && link.Part == DataExportPart.Data && link.CreatedAtUtc >= sinceUtc, cancellationToken);

    public async Task AddAsync(IReadOnlyCollection<DataExportLink> links, int maxExportsPerDay, CancellationToken cancellationToken = default)
    {
        var data = links.Single(link => link.Part == DataExportPart.Data);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        // Serialize issuance for this user across replicas, including the quota check. Concurrent requests cannot all pass count-then-add.
        var userId = await dbContext.Database.SqlQuery<long>($"SELECT [Id] AS [Value] FROM [users].[Users] WITH (UPDLOCK,HOLDLOCK) WHERE [Id] = {data.UserId}")
            .SingleOrDefaultAsync(cancellationToken);
        if (userId == 0) throw new DataExportPartNotFoundException();
        if (await CountExportsSinceAsync(data.UserId, data.CreatedAtUtc.AddDays(-1), cancellationToken) >= maxExportsPerDay)
            throw new DataExportRateLimitedException();
        dbContext.DataExportLinks.AddRange(links);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<DataExportLink?> ClaimAsync(byte[] tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        // One conditional UPDATE across replicas. Neither configuration nor a concurrent request can grant a second use.
        // Also cap existing grants at 15 minutes even if an older configuration issued a longer expiry.
        var claimed = await dbContext.DataExportLinks
            .Where(link => link.TokenHash == tokenHash && link.ExpiresAtUtc > nowUtc && link.UseCount == 0
                && link.CreatedAtUtc <= nowUtc && link.CreatedAtUtc > nowUtc.AddMinutes(-15))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(link => link.UseCount, link => link.UseCount + 1)
                    .SetProperty(link => link.LastUsedAtUtc, nowUtc),
                cancellationToken);
        if (claimed == 0)
        {
            return null;
        }

        return await dbContext.DataExportLinks
            .AsNoTracking()
            .SingleOrDefaultAsync(link => link.TokenHash == tokenHash, cancellationToken);
    }
}
