using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Identity;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Users;

/// <summary>
/// Covers the one-time default-Category seed added to CurrentUserProvisioningStore.CreateOrGetAsync
/// (see the UI refactor plan's §5) - a brand-new external identity gets exactly 4 seeded Collections
/// in the right locale's names, and calling CreateOrGetAsync again for the same identity (the same
/// code path a concurrent race takes - see ExternalIdentityRaceRecovery) never doubles them.
/// </summary>
public sealed class DefaultCollectionSeedIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private readonly List<Guid> _tenantIdsToCleanUp = [];

    public Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run default-Collection-seed integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        foreach (var tenantId in _tenantIdsToCleanUp)
        {
            var userIds = await _dbContext.ExternalIdentities
                .AsNoTracking()
                .Where(identity => identity.TenantId == tenantId)
                .Select(identity => identity.UserId)
                .ToListAsync();

            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM collections.Collections WHERE UserId IN (SELECT UserId FROM [identity].ExternalIdentities WHERE TenantId = {tenantId})");
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM [identity].ExternalIdentities WHERE TenantId = {tenantId}");
            foreach (var userId in userIds)
            {
                await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"DELETE FROM users.Users WHERE Id = {userId}");
            }
        }

        await _dbContext.DisposeAsync();
    }

    private CurrentUserBootstrapData MakeBootstrapData(Guid tenantId, string preferredLocale)
    {
        _tenantIdsToCleanUp.Add(tenantId);
        return new CurrentUserBootstrapData(
            new ExternalIdentityPrincipal(tenantId, Guid.NewGuid()),
            preferredLocale,
            "UTC",
            DefaultCurrencyCode: null,
            DateTimeOffset.UtcNow);
    }

    private async Task<long> GetSeededUserIdAsync(ExternalIdentityPrincipal externalIdentity)
    {
        var identity = await _dbContext.ExternalIdentities.AsNoTracking().SingleAsync(
            e => e.TenantId == externalIdentity.TenantId && e.ObjectId == externalIdentity.ObjectId);
        return identity.UserId;
    }

    [Fact]
    public async Task CreateOrGetAsync_ForANewKoreanLocaleUser_SeedsExactlyFourDefaultCollectionsInKorean()
    {
        var store = new CurrentUserProvisioningStore(_dbContext);
        var data = MakeBootstrapData(Guid.NewGuid(), "ko-KR");

        await store.CreateOrGetAsync(data);
        _dbContext.ChangeTracker.Clear();

        var userId = await GetSeededUserIdAsync(data.ExternalIdentity);
        var names = await _dbContext.Collections.AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => c.Name)
            .ToListAsync();

        Assert.Equal(4, names.Count);
        Assert.Equal(new[] { "위시리스트", "음식", "영화", "애니" }.OrderBy(n => n), names.OrderBy(n => n));
        Assert.All(
            await _dbContext.Collections.AsNoTracking().Where(c => c.UserId == userId).ToListAsync(),
            c => Assert.False(c.IsFavorite));
    }

    [Fact]
    public async Task CreateOrGetAsync_ForANewEnglishLocaleUser_SeedsExactlyFourDefaultCollectionsInEnglish()
    {
        var store = new CurrentUserProvisioningStore(_dbContext);
        var data = MakeBootstrapData(Guid.NewGuid(), "en-US");

        await store.CreateOrGetAsync(data);
        _dbContext.ChangeTracker.Clear();

        var userId = await GetSeededUserIdAsync(data.ExternalIdentity);
        var names = await _dbContext.Collections.AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => c.Name)
            .ToListAsync();

        Assert.Equal(4, names.Count);
        Assert.Equal(new[] { "Anime", "Food", "Movies", "Wishlist" }.OrderBy(n => n), names.OrderBy(n => n));
    }

    [Fact]
    public async Task CreateOrGetAsync_CalledTwiceForTheSameExternalIdentity_NeverDoublesTheSeed()
    {
        var store = new CurrentUserProvisioningStore(_dbContext);
        var data = MakeBootstrapData(Guid.NewGuid(), "ko-KR");

        // First call: commits a new User + its 4 seeded Collections + the ExternalIdentity row.
        await store.CreateOrGetAsync(data);
        _dbContext.ChangeTracker.Clear();

        // Second call for the exact same external identity takes the same code path a genuine
        // concurrent race would (ExternalIdentityRaceRecovery): it still builds a brand-new User +
        // 4 Collections in its own transaction, but the ExternalIdentity insert violates the unique
        // (TenantId, ObjectId) index, so the whole second transaction - User and Collections
        // included - rolls back. This must not throw (the recovery path swallows it) and must not
        // leave a second User or a second set of Collections behind.
        await store.CreateOrGetAsync(data);
        _dbContext.ChangeTracker.Clear();

        var identityCount = await _dbContext.ExternalIdentities.AsNoTracking()
            .CountAsync(e => e.TenantId == data.ExternalIdentity.TenantId && e.ObjectId == data.ExternalIdentity.ObjectId);
        Assert.Equal(1, identityCount);

        var userId = await GetSeededUserIdAsync(data.ExternalIdentity);
        var collectionCount = await _dbContext.Collections.AsNoTracking().CountAsync(c => c.UserId == userId);
        Assert.Equal(4, collectionCount);
    }
}
