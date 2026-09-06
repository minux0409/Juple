using Juple.Application.Push;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Push;

public sealed class PushDeviceRegistrationStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run PushDeviceRegistration store " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    private PushDeviceRegistrationStore NewStore() => new(_dbContext);

    [Fact]
    public async Task RegisterAsync_NewInstallation_CreatesEnabledRegistration()
    {
        var store = NewStore();

        var registered = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "ko", DateTimeOffset.UtcNow);

        Assert.True(registered.IsEnabled);
        Assert.Equal("install-1", registered.InstallationId);
        Assert.Equal("ko", registered.Locale);
        Assert.Equal(PushPlatform.Android, registered.Platform);
    }

    [Fact]
    public async Task RegisterAsync_SameInstallationSameUser_IsIdempotentUpdateRatherThanInsertingSecondRow()
    {
        var store = NewStore();
        var first = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow);

        var second = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow.AddMinutes(5));

        Assert.Equal(first.Id, second.Id);
        var enabled = await store.ListEnabledAsync(_userId);
        Assert.Single(enabled);
    }

    [Fact]
    public async Task RegisterAsync_TokenRotation_UpdatesSameInstallationRowInPlace()
    {
        var store = NewStore();
        var first = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow);

        var rotated = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-2-rotated", "ko", DateTimeOffset.UtcNow.AddMinutes(5));

        Assert.Equal(first.Id, rotated.Id);
        Assert.Equal("ko", rotated.Locale);
        var enabled = await store.ListEnabledAsync(_userId);
        var only = Assert.Single(enabled);
        Assert.Equal("token-2-rotated", only.PushToken);
    }

    [Fact]
    public async Task RegisterAsync_DisabledRegistration_ReenablesOnReregistration()
    {
        var store = NewStore();
        var registered = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, "install-1", DateTimeOffset.UtcNow);

        var reregistered = await store.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow);

        Assert.Equal(registered.Id, reregistered.Id);
        Assert.True(reregistered.IsEnabled);
    }

    [Fact]
    public async Task RegisterAsync_SameInstallationDifferentUser_TransfersOwnershipToTheNewUser()
    {
        var store = NewStore();
        await store.RegisterAsync(
            _userId, PushPlatform.Android, "shared-device", "token-1", "en", DateTimeOffset.UtcNow);

        await store.RegisterAsync(
            _otherUserId, PushPlatform.Android, "shared-device", "token-1", "ko", DateTimeOffset.UtcNow.AddMinutes(1));

        Assert.Empty(await store.ListEnabledAsync(_userId));
        var theirs = Assert.Single(await store.ListEnabledAsync(_otherUserId));
        Assert.Equal("shared-device", theirs.InstallationId);

        // Exactly one row for this installation ever exists - ownership moved, it was never
        // duplicated (see UX_PushDeviceRegistrations_Platform_InstallationId).
        var totalRows = await _dbContext.PushDeviceRegistrations
            .CountAsync(r => r.Platform == PushPlatform.Android && r.InstallationId == "shared-device");
        Assert.Equal(1, totalRows);
    }

    [Fact]
    public async Task RegisterAsync_AfterOwnershipTransfer_PreviousOwnerCanNoLongerDisableIt()
    {
        var store = NewStore();
        await store.RegisterAsync(_userId, PushPlatform.Android, "shared-device", "token-1", "en", DateTimeOffset.UtcNow);
        await store.RegisterAsync(_otherUserId, PushPlatform.Android, "shared-device", "token-1", "en", DateTimeOffset.UtcNow);

        await Assert.ThrowsAsync<PushDeviceRegistrationNotFoundException>(
            () => store.DisableAsync(_userId, "shared-device", DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task RegisterAsync_ConcurrentAccountSwitchFromIndependentContexts_ResultsInExactlyOneRowWithASingleOwner()
    {
        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var storeA = new PushDeviceRegistrationStore(contextA);
        var storeB = new PushDeviceRegistrationStore(contextB);
        var nowUtc = DateTimeOffset.UtcNow;

        // Both users register the exact same (Platform, InstallationId) at the same time - as if two
        // sign-ins raced on the same physical device. The DB's unique constraint, not an
        // application-level pre-check, must make this resolve to a single owner.
        await Task.WhenAll(
            storeA.RegisterAsync(_userId, PushPlatform.Android, "shared-device", "token-a", "en", nowUtc),
            storeB.RegisterAsync(_otherUserId, PushPlatform.Android, "shared-device", "token-b", "en", nowUtc));

        _dbContext.ChangeTracker.Clear();
        var rows = await _dbContext.PushDeviceRegistrations
            .Where(r => r.Platform == PushPlatform.Android && r.InstallationId == "shared-device")
            .ToListAsync();
        var row = Assert.Single(rows);
        Assert.True(row.UserId == _userId || row.UserId == _otherUserId);

        var myDevices = await NewStore().ListEnabledAsync(_userId);
        var theirDevices = await NewStore().ListEnabledAsync(_otherUserId);
        // Exactly one of the two users ends up with this device enabled - never both, never neither.
        Assert.Equal(1, myDevices.Count + theirDevices.Count);
    }

    [Fact]
    public async Task RegisterAsync_DifferentInstallationIdsForSameUser_KeepsBothEnabled()
    {
        var store = NewStore();

        await store.RegisterAsync(_userId, PushPlatform.Android, "phone", "token-phone", "en", DateTimeOffset.UtcNow);
        await store.RegisterAsync(_userId, PushPlatform.Ios, "tablet", "token-tablet", "en", DateTimeOffset.UtcNow);

        var devices = await store.ListEnabledAsync(_userId);
        Assert.Equal(2, devices.Count);
    }

    [Fact]
    public async Task DisableAsync_OnAnotherUsersInstallationId_ThrowsNotFound()
    {
        var store = NewStore();
        await store.RegisterAsync(
            _otherUserId, PushPlatform.Android, "their-install", "token", "en", DateTimeOffset.UtcNow);

        await Assert.ThrowsAsync<PushDeviceRegistrationNotFoundException>(
            () => store.DisableAsync(_userId, "their-install", DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task DisableAsync_WhenInstallationIdNeverRegistered_ThrowsNotFound()
    {
        var store = NewStore();

        await Assert.ThrowsAsync<PushDeviceRegistrationNotFoundException>(
            () => store.DisableAsync(_userId, "never-registered", DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task DisableAsync_WhenAlreadyDisabled_IsIdempotent()
    {
        var store = NewStore();
        await store.RegisterAsync(_userId, PushPlatform.Android, "install-1", "token", "en", DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, "install-1", DateTimeOffset.UtcNow);

        await store.DisableAsync(_userId, "install-1", DateTimeOffset.UtcNow.AddMinutes(1));

        Assert.Empty(await store.ListEnabledAsync(_userId));
    }

    [Fact]
    public async Task ListEnabledAsync_ExcludesDisabledAndOtherUsersRegistrations()
    {
        var store = NewStore();
        await store.RegisterAsync(_userId, PushPlatform.Android, "enabled", "token-a", "en", DateTimeOffset.UtcNow);
        await store.RegisterAsync(_userId, PushPlatform.Android, "disabled", "token-b", "en", DateTimeOffset.UtcNow);
        await store.DisableAsync(_userId, "disabled", DateTimeOffset.UtcNow);
        await store.RegisterAsync(_otherUserId, PushPlatform.Android, "theirs", "token-c", "en", DateTimeOffset.UtcNow);

        var devices = await store.ListEnabledAsync(_userId);

        Assert.Single(devices);
        Assert.Equal("enabled", devices[0].InstallationId);
    }

    [Fact]
    public void IndexModel_PlatformInstallationIdUnique_ExistsForGlobalOwnershipEnforcement()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(PushDeviceRegistration))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "UX_PushDeviceRegistrations_Platform_InstallationId");

        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
        Assert.Equal(new[] { "Platform", "InstallationId" }, index.Properties.Select(p => p.Name));
    }
}
