using System.Security.Cryptography;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Push;

/// <summary>
/// Android (FCM) registration behaviour that existing Android apps rely on, and the concurrency of registrations, against the real
/// schema - through the same RegisterPushDeviceService + PushDeviceRegistrationStore the API uses, each call on its own DbContext like
/// separate requests.
/// </summary>
public sealed class PushRegistrationRegressionIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private readonly List<long> _userIds = [];
    private readonly string _suffix = Guid.NewGuid().ToString("N");

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        await using var db = NewDb();
        for (var index = 0; index < 3; index++)
        {
            var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
            db.Users.Add(user);
            await db.SaveChangesAsync();
            _userIds.Add(user.Id);
        }
    }

    public async Task DisposeAsync()
    {
        await using var db = NewDb();
        foreach (var userId in _userIds)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {userId}");
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {userId}");
        }
    }

    private long A => _userIds[0];

    private long B => _userIds[1];

    [Fact]
    public async Task AnOldAndroidRequest_WithoutTheNewField_RegistersExactlyAsBefore()
    {
        // Exactly what installed Android apps send: platform, installationId, pushToken, locale - nothing else.
        var token = "fMl3:APA91bF" + Guid.NewGuid().ToString("N") + "_-x";
        var registered = await RegisterAsync(A, PushPlatform.Android, Id("phone"), token);

        Assert.True(registered.IsEnabled);
        var row = await RowAsync(Id("phone"), PushPlatform.Android);
        Assert.Equal((token, (ApnsEnvironment?)null, "ko"), (row.PushToken, row.ApnsEnvironment, row.Locale));
    }

    [Fact]
    public async Task OnePerson_ManyDevices_AllStayEnabled_AndATokenRotationUpdatesTheSameRow()
    {
        await RegisterAsync(A, PushPlatform.Android, Id("phone"), Fcm());
        await RegisterAsync(A, PushPlatform.Android, Id("tablet"), Fcm());
        await RegisterAsync(A, PushPlatform.Ios, Id("iphone"), Apns());
        Assert.Equal(3, await EnabledCountAsync(A));

        var rotated = Fcm();
        await RegisterAsync(A, PushPlatform.Android, Id("phone"), rotated);
        Assert.Equal(3, await EnabledCountAsync(A));
        Assert.Equal(rotated, (await RowAsync(Id("phone"), PushPlatform.Android)).PushToken);
    }

    [Fact]
    public async Task AReinstallWithANewInstallationId_AndANewToken_KeepsTheOldRowUntilFcmReportsItDead()
    {
        // Unchanged behaviour: a new install with a NEW token is another registration; the old token is disabled when FCM answers
        // UNREGISTERED for it (PushSendFailureCodes.IsPermanent), not guessed at registration.
        await RegisterAsync(A, PushPlatform.Android, Id("before-reinstall"), Fcm());
        await RegisterAsync(A, PushPlatform.Android, Id("after-reinstall"), Fcm());
        Assert.Equal(2, await EnabledCountAsync(A));
    }

    [Fact]
    public async Task AReinstallWithANewInstallationId_ButTheSameToken_LeavesOneEnabledRegistration()
    {
        var token = Fcm();
        await RegisterAsync(A, PushPlatform.Android, Id("before"), token);
        await RegisterAsync(A, PushPlatform.Android, Id("after"), token);

        Assert.False((await RowAsync(Id("before"), PushPlatform.Android)).IsEnabled);
        Assert.True((await RowAsync(Id("after"), PushPlatform.Android)).IsEnabled);
    }

    [Fact]
    public async Task LogoutThenAnotherPersonSignsIn_TheDeviceFollowsTheNewPersonOnly()
    {
        var token = Fcm();
        await RegisterAsync(A, PushPlatform.Android, Id("shared-phone"), token);
        await using (var db = NewDb())
        {
            await new PushDeviceRegistrationStore(db).DisableAsync(A, Id("shared-phone"), DateTimeOffset.UtcNow);
        }

        // Same installation (account switch on the same app install).
        await RegisterAsync(B, PushPlatform.Android, Id("shared-phone"), token);
        Assert.Equal(0, await EnabledCountAsync(A));
        Assert.Equal(1, await EnabledCountAsync(B));

        // The logout never reached the server and the app regenerated its installation id: still only the new person.
        var otherToken = Fcm();
        await RegisterAsync(A, PushPlatform.Android, Id("phone-2"), otherToken);
        await RegisterAsync(B, PushPlatform.Android, Id("phone-2-regenerated"), otherToken);
        Assert.Equal(0, await EnabledCountAsync(A));
        Assert.Equal(2, await EnabledCountAsync(B));
    }

    [Fact]
    public async Task ConcurrentRegistrationsOfOneTokenUnderDifferentInstallations_LeaveExactlyOneEnabledRow()
    {
        for (var round = 0; round < 15; round++)
        {
            var token = Fcm();
            var installations = Enumerable.Range(0, 4).Select(index => Id($"race-{round}-{index}")).ToArray();
            var users = new[] { A, B, A, B };

            await Task.WhenAll(installations.Select((installation, index) => Task.Run(() => RegisterAsync(users[index], PushPlatform.Android, installation, token))));

            await using var db = NewDb();
            var rows = await db.PushDeviceRegistrations.AsNoTracking()
                .Where(registration => registration.Platform == PushPlatform.Android && registration.PushToken == token)
                .ToListAsync();
            Assert.Equal(4, rows.Count);
            Assert.Single(rows, registration => registration.IsEnabled);
        }
    }

    [Fact]
    public async Task ConcurrentRegistrationsOfOneInstallation_ByTwoPeople_LeaveOneRowWithOneOwner()
    {
        for (var round = 0; round < 15; round++)
        {
            var installation = Id($"switch-{round}");
            var tokenA = Fcm();
            var tokenB = Fcm();

            await Task.WhenAll(
                Task.Run(() => RegisterAsync(A, PushPlatform.Android, installation, tokenA)),
                Task.Run(() => RegisterAsync(B, PushPlatform.Android, installation, tokenB)),
                Task.Run(() => RegisterAsync(A, PushPlatform.Android, installation, tokenA)));

            var row = await RowAsync(installation, PushPlatform.Android);
            Assert.True(row.IsEnabled);
            Assert.Contains(row.UserId, new[] { A, B });
            Assert.Equal(row.UserId == A ? tokenA : tokenB, row.PushToken);
        }
    }

    [Fact]
    public async Task TheSameDeviceRegisteringTwiceAtOnce_StaysOneEnabledRow()
    {
        var token = Apns();
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(() => RegisterAsync(A, PushPlatform.Ios, Id("double-launch"), token))));
        await using var db = NewDb();
        var rows = await db.PushDeviceRegistrations.AsNoTracking().Where(registration => registration.InstallationId == Id("double-launch")).ToListAsync();
        Assert.True(Assert.Single(rows).IsEnabled);
    }

    // ---------- helpers ----------

    private JupleDbContext NewDb() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private string Id(string name) => $"{name}-{_suffix}";

    private static string Fcm() => "fcm-" + Guid.NewGuid().ToString("N") + ":APA91b";

    private static string Apns() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    private async Task<Juple.Application.Push.PushDeviceRegistrationDto> RegisterAsync(long userId, PushPlatform platform, string installationId, string token)
    {
        await using var db = NewDb();
        return await new RegisterPushDeviceService(new PushDeviceRegistrationStore(db), TimeProvider.System)
            .RegisterAsync(userId, new RegisterPushDeviceCommand(platform, installationId, token, "ko"));
    }

    private async Task<PushDeviceRegistration> RowAsync(string installationId, PushPlatform platform)
    {
        await using var db = NewDb();
        return await db.PushDeviceRegistrations.AsNoTracking().SingleAsync(registration => registration.InstallationId == installationId && registration.Platform == platform);
    }

    private async Task<int> EnabledCountAsync(long userId)
    {
        await using var db = NewDb();
        return await db.PushDeviceRegistrations.AsNoTracking().CountAsync(registration => registration.UserId == userId && registration.IsEnabled);
    }
}
