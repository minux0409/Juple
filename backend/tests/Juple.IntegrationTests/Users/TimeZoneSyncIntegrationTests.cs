using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Identity;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Users;

/// <summary>
/// Covers CurrentUserProvisioningStore.TrySyncTimeZoneAndGetPlanAsync - the fix for an existing
/// User's stored TimeZoneId never catching up to the device's real IANA zone on later bootstrap
/// calls (previously CurrentUserBootstrapService returned immediately for any already-provisioned
/// external identity, so a User created with a stale/placeholder TimeZoneId such as "GMT" stayed
/// stuck there forever). See CurrentUserBootstrapServiceTests for the Application-layer unit tests
/// covering the validation-before-sync ordering.
/// </summary>
public sealed class TimeZoneSyncIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private readonly List<Guid> _tenantIdsToCleanUp = [];

    public Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run timezone-sync integration tests " +
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

    private async Task<ExternalIdentityPrincipal> SeedExistingUserAsync(string initialTimeZoneId)
    {
        var tenantId = Guid.NewGuid();
        _tenantIdsToCleanUp.Add(tenantId);
        var externalIdentity = new ExternalIdentityPrincipal(tenantId, Guid.NewGuid());

        var store = new CurrentUserProvisioningStore(_dbContext);
        await store.CreateAsync(new CurrentUserBootstrapData(
            externalIdentity,
            "en-US",
            initialTimeZoneId,
            DefaultCurrencyCode: null,
            DateTimeOffset.UtcNow));
        _dbContext.ChangeTracker.Clear();

        return externalIdentity;
    }

    private async Task<(string TimeZoneId, DateTimeOffset UpdatedAtUtc)> GetUserTimeZoneStateAsync(
        ExternalIdentityPrincipal externalIdentity)
    {
        var identity = await _dbContext.ExternalIdentities.AsNoTracking().SingleAsync(
            e => e.TenantId == externalIdentity.TenantId && e.ObjectId == externalIdentity.ObjectId);
        var user = await _dbContext.Users.AsNoTracking().SingleAsync(u => u.Id == identity.UserId);
        return (user.TimeZoneId, user.UpdatedAtUtc);
    }

    [Fact]
    public async Task TrySyncTimeZoneAndGetPlanAsync_WhenStoredTimeZoneDiffers_UpdatesToTheDeviceTimeZone()
    {
        // Mirrors the real bug: a User row created with "GMT" (e.g. a stale/placeholder value from
        // before this device actually reported its real zone) must be corrected once a bootstrap
        // call arrives carrying the device's real IANA zone.
        var externalIdentity = await SeedExistingUserAsync("GMT");
        var store = new CurrentUserProvisioningStore(_dbContext);
        var updatedAtUtc = DateTimeOffset.UtcNow;

        var plan = await store.TrySyncTimeZoneAndGetPlanAsync(externalIdentity, "Asia/Seoul", updatedAtUtc);
        _dbContext.ChangeTracker.Clear();

        Assert.NotNull(plan);
        var (timeZoneId, storedUpdatedAtUtc) = await GetUserTimeZoneStateAsync(externalIdentity);
        Assert.Equal("Asia/Seoul", timeZoneId);
        Assert.Equal(updatedAtUtc, storedUpdatedAtUtc);
    }

    [Fact]
    public async Task TrySyncTimeZoneAndGetPlanAsync_WhenStoredTimeZoneAlreadyMatches_DoesNotWrite()
    {
        var externalIdentity = await SeedExistingUserAsync("Asia/Seoul");
        var (_, originalUpdatedAtUtc) = await GetUserTimeZoneStateAsync(externalIdentity);
        var store = new CurrentUserProvisioningStore(_dbContext);

        // A later, unrelated point in time - if this were (incorrectly) written unconditionally,
        // UpdatedAtUtc would move to it even though the timezone itself did not change.
        var plan = await store.TrySyncTimeZoneAndGetPlanAsync(
            externalIdentity, "Asia/Seoul", originalUpdatedAtUtc.AddDays(1));
        _dbContext.ChangeTracker.Clear();

        Assert.NotNull(plan);
        var (timeZoneId, storedUpdatedAtUtc) = await GetUserTimeZoneStateAsync(externalIdentity);
        Assert.Equal("Asia/Seoul", timeZoneId);
        Assert.Equal(originalUpdatedAtUtc, storedUpdatedAtUtc);
    }

    [Fact]
    public async Task TrySyncTimeZoneAndGetPlanAsync_WhenIdentityDoesNotExist_ReturnsNullAndWritesNothing()
    {
        var externalIdentity = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        var store = new CurrentUserProvisioningStore(_dbContext);

        var plan = await store.TrySyncTimeZoneAndGetPlanAsync(
            externalIdentity, "Asia/Seoul", DateTimeOffset.UtcNow);

        Assert.Null(plan);
    }
}
