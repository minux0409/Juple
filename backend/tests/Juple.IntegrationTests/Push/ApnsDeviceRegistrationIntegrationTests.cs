using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Push;

/// <summary>
/// iOS registrations against the real schema: the APNs gateway is stored and follows re-registration, the database-computed token hash
/// matches the application's, and one token never stays enabled on two registrations (another installation or another account).
/// </summary>
public sealed class ApnsDeviceRegistrationIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private long _userId;
    private long _otherUserId;
    private readonly string _suffix = Guid.NewGuid().ToString("N");

    private string Id(string name) => $"{name}-{_suffix}";

    private readonly string _token = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var other = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.AddRange(user, other);
        await _db.SaveChangesAsync();
        (_userId, _otherUserId) = (user.Id, other.Id);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task AnIosRegistration_KeepsItsGateway_FollowsReregistration_AndIsDisabledOnLogout()
    {
        var store = new PushDeviceRegistrationStore(_db);
        await store.RegisterAsync(_userId, PushPlatform.Ios, Id("iphone"), _token, "ko", DateTimeOffset.UtcNow, ApnsEnvironment.Development);
        Assert.Equal(ApnsEnvironment.Development, (await RowAsync(Id("iphone"))).ApnsEnvironment);

        // A TestFlight build on the same install re-registers with a production token.
        var productionToken = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Ios, Id("iphone"), productionToken, "ko", DateTimeOffset.UtcNow, ApnsEnvironment.Production);
        var row = await RowAsync(Id("iphone"));
        Assert.Equal((ApnsEnvironment.Production, productionToken), (row.ApnsEnvironment!.Value, row.PushToken));
        Assert.Equal(PushTokenHash.Of(productionToken), row.PushTokenHash);

        await new PushDeviceRegistrationStore(_db).DisableAsync(_userId, Id("iphone"), DateTimeOffset.UtcNow);
        Assert.False((await RowAsync(Id("iphone"))).IsEnabled);
        Assert.Empty(await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_userId));
    }

    [Fact]
    public async Task TheSameTokenUnderANewInstallation_OrAnotherAccount_LeavesOnlyTheNewestRegistrationEnabled()
    {
        // The app lost its installation id (reinstall restored from backup, cleared storage) but iOS kept the token.
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Ios, Id("old-install"), _token, "ko", DateTimeOffset.UtcNow);
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Ios, Id("new-install"), _token, "ko", DateTimeOffset.UtcNow);
        Assert.False((await RowAsync(Id("old-install"))).IsEnabled);
        Assert.True((await RowAsync(Id("new-install"))).IsEnabled);

        // Another account signs in on that phone under yet another installation id: the first account must never get its pushes there.
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_otherUserId, PushPlatform.Ios, Id("other-install"), _token, "en", DateTimeOffset.UtcNow);
        Assert.Empty(await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_userId));
        Assert.Single(await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_otherUserId));

        // Coming back to the first account re-registers its installation: now only that one is enabled again.
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Ios, Id("new-install"), _token, "ko", DateTimeOffset.UtcNow);
        Assert.Single(await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_userId));
        Assert.Empty(await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_otherUserId));
    }

    [Fact]
    public async Task TheSameTokenOnTheOtherPlatform_IsADifferentDevice_AndDifferentTokensStayEnabled()
    {
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Ios, Id("iphone"), _token, "ko", DateTimeOffset.UtcNow);
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Android, Id("android"), _token, "ko", DateTimeOffset.UtcNow);
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Android, Id("tablet"), "fcm-" + Guid.NewGuid().ToString("N"), "ko", DateTimeOffset.UtcNow);

        var enabled = await new PushDeviceRegistrationStore(_db).ListEnabledAsync(_userId);
        Assert.Equal(new[] { Id("android"), Id("iphone"), Id("tablet") }, enabled.Select(device => device.InstallationId).Order(StringComparer.Ordinal).ToArray());
        Assert.Null(enabled.Single(device => device.InstallationId == Id("android")).ApnsEnvironment);
    }

    [Fact]
    public async Task TheDatabase_RefusesAnAndroidRowWithAnApnsEnvironment()
    {
        await new PushDeviceRegistrationStore(_db).RegisterAsync(_userId, PushPlatform.Android, Id("android"), "fcm-" + Guid.NewGuid().ToString("N"), "ko", DateTimeOffset.UtcNow);
        await Assert.ThrowsAnyAsync<Exception>(() => _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE push.PushDeviceRegistrations SET ApnsEnvironment = 0 WHERE UserId = {_userId} AND InstallationId = {Id("android")}"));
    }

    private Task<PushDeviceRegistration> RowAsync(string installationId) =>
        _db.PushDeviceRegistrations.AsNoTracking().SingleAsync(registration => registration.InstallationId == installationId && (registration.UserId == _userId || registration.UserId == _otherUserId));
}
