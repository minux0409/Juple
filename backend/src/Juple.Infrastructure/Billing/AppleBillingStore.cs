using Juple.Application.Billing.Apple;
using Juple.Domain.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

/// <summary>
/// The App Store flavour of <see cref="GoogleBillingStore"/>: the same purchase and event operations on App Store rows (the base class
/// filters every query by <see cref="Source"/>), and the App Account Token (a UUID) as the account key instead of Google's opaque id.
/// </summary>
public sealed class AppleBillingStore : GoogleBillingStore, IAppleBillingStore
{
    private readonly JupleDbContext dbContext;

    public AppleBillingStore(JupleDbContext dbContext)
        : base(dbContext)
    {
        this.dbContext = dbContext;
    }

    protected override StoreSource Source => StoreSource.AppStore;

    public override async Task EnsureAccountLinkAsync(long userId, string accountKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var token = ParseToken(accountKey);
        if (await dbContext.AppleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == userId, cancellationToken))
        {
            return;
        }

        dbContext.AppleAccountLinks.Add(new AppleAccountLink(userId, token, nowUtc));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent call for the same account won: the link exists.
            dbContext.ChangeTracker.Clear();
            if (!await dbContext.AppleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == userId, cancellationToken))
            {
                throw;
            }
        }
    }

    public override Task<long?> FindUserIdByAccountKeyAsync(string accountKey, CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(accountKey, out var token))
        {
            return Task.FromResult<long?>(null);
        }

        return dbContext.AppleAccountLinks.AsNoTracking()
            .Where(link => link.AppAccountToken == token)
            .Select(link => (long?)link.UserId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static Guid ParseToken(string accountKey) =>
        Guid.TryParse(accountKey, out var token) ? token : throw new ArgumentException("Not an App Account Token.", nameof(accountKey));
}
