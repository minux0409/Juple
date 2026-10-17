using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Collections;
using Juple.Domain.Identity;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Users;

/// <summary>
/// A brand-new user is provisioned with NO Collections (the former Wishlist / Food / Movies seed is gone), in every locale, while
/// Collections that already exist for a user - including ones the user typed with those very names - are never touched.
/// </summary>
public sealed class NewUserHasNoDefaultCollectionsIntegrationTests : IAsyncLifetime
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

    [Theory]
    [InlineData("ko-KR")]
    [InlineData("en-US")]
    [InlineData("ja-JP")]
    public async Task CreateAsync_ForANewUser_CreatesNoCollections(string locale)
    {
        var store = new CurrentUserProvisioningStore(_dbContext);
        var data = MakeBootstrapData(Guid.NewGuid(), locale);

        await store.CreateAsync(data);
        _dbContext.ChangeTracker.Clear();

        var userId = await GetSeededUserIdAsync(data.ExternalIdentity);
        Assert.Equal(0, await _dbContext.Collections.AsNoTracking().CountAsync(c => c.UserId == userId));
    }

    [Fact]
    public async Task CreateAsync_CalledAgainForAnExistingIdentity_LeavesTheUsersOwnCollectionsUntouched()
    {
        var store = new CurrentUserProvisioningStore(_dbContext);
        var data = MakeBootstrapData(Guid.NewGuid(), "ko-KR");
        await store.CreateAsync(data);
        _dbContext.ChangeTracker.Clear();

        // The user (an existing account) has Collections of their own - even with the old default names.
        var userId = await GetSeededUserIdAsync(data.ExternalIdentity);
        foreach (var name in new[] { "영화", "음식", "위시리스트", "My own" })
        {
            _dbContext.Collections.Add(new Collection(userId, name, name.Trim().ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow));
        }
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        // The race / repeat path rolls back its own transaction; it must not touch what exists.
        await store.CreateAsync(data);
        _dbContext.ChangeTracker.Clear();

        var names = await _dbContext.Collections.AsNoTracking().Where(c => c.UserId == userId).Select(c => c.Name).ToListAsync();
        Assert.Equal(new[] { "My own", "영화", "위시리스트", "음식" }.OrderBy(n => n), names.OrderBy(n => n));
        Assert.Equal(1, await _dbContext.ExternalIdentities.AsNoTracking().CountAsync(e => e.TenantId == data.ExternalIdentity.TenantId && e.ObjectId == data.ExternalIdentity.ObjectId));
    }
}
